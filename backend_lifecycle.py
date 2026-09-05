"""Flask-owned idle shutdown after Electron has closed its last window."""
import json
import os
import time
from threading import RLock, Timer


def electron_process_is_running(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def active_electron_instances(instance_file, is_running=electron_process_is_running):
    if not instance_file:
        return False
    try:
        with open(instance_file, encoding="utf-8") as file:
            pids = json.load(file)
    except (OSError, json.JSONDecodeError):
        return False
    return isinstance(pids, list) and any(is_running(pid) for pid in pids)


class IdleBackendShutdown:
    """Poll the Electron registry for a grace period before ending Flask."""
    def __init__(self, instance_file, terminate, grace_seconds=10, poll_seconds=1,
                 is_active=active_electron_instances, timer_factory=Timer, clock=time.monotonic):
        self.instance_file = instance_file
        self.terminate = terminate
        self.grace_seconds = grace_seconds
        self.poll_seconds = poll_seconds
        self.is_active = is_active
        self.timer_factory = timer_factory
        self.clock = clock
        self._lock = RLock()
        self._timer = None
        self._generation = 0

    def cancel(self):
        with self._lock:
            self._generation += 1
            if self._timer:
                self._timer.cancel()
                self._timer = None

    def schedule_if_idle(self):
        with self._lock:
            self.cancel()
            generation = self._generation
            deadline = self.clock() + self.grace_seconds
        self._poll(generation, deadline, seen_electron=False)

    def _poll(self, generation, deadline, seen_electron):
        with self._lock:
            if generation != self._generation:
                return
        seen_electron = seen_electron or self.is_active(self.instance_file)
        remaining = deadline - self.clock()
        if remaining <= 0:
            if not seen_electron:
                self.terminate()
            return
        timer = self.timer_factory(min(self.poll_seconds, remaining), self._poll,
                                   args=(generation, deadline, seen_electron))
        timer.daemon = True
        with self._lock:
            if generation != self._generation:
                return
            self._timer = timer
        timer.start()
