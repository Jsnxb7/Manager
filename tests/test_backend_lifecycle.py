import json
import os
import tempfile
import unittest

from backend_lifecycle import IdleBackendShutdown, active_electron_instances


class Clock:
    def __init__(self):
        self.value = 0

    def __call__(self):
        return self.value


class Timer:
    scheduled = []

    def __init__(self, delay, callback, args=()):
        self.delay = delay
        self.callback = callback
        self.args = args
        self.daemon = False
        self.cancelled = False

    def start(self):
        Timer.scheduled.append(self)

    def cancel(self):
        self.cancelled = True


def run_timers(clock):
    while Timer.scheduled:
        timer = Timer.scheduled.pop(0)
        if timer.cancelled:
            continue
        clock.value += timer.delay
        timer.callback(*timer.args)


class BackendLifecycleTests(unittest.TestCase):
    def setUp(self):
        Timer.scheduled = []
        self.clock = Clock()
        self.terminated = 0

    def scheduler(self, is_active):
        return IdleBackendShutdown(
            'registry.json',
            lambda: setattr(self, 'terminated', self.terminated + 1),
            grace_seconds=10,
            poll_seconds=1,
            is_active=is_active,
            timer_factory=Timer,
            clock=self.clock,
        )

    def test_terminates_only_after_full_idle_grace_period(self):
        scheduler = self.scheduler(lambda _path: False)
        scheduler.schedule_if_idle()
        self.assertEqual(self.terminated, 0)
        run_timers(self.clock)
        self.assertEqual(self.clock.value, 10)
        self.assertEqual(self.terminated, 1)

    def test_keeps_backend_when_an_electron_instance_appears_during_grace_period(self):
        scheduler = self.scheduler(lambda _path: self.clock.value >= 4)
        scheduler.schedule_if_idle()
        run_timers(self.clock)
        self.assertEqual(self.terminated, 0)

    def test_terminates_when_electron_closes_before_grace_period_ends(self):
        scheduler = self.scheduler(lambda _path: 4 <= self.clock.value < 7)
        scheduler.schedule_if_idle()
        run_timers(self.clock)
        self.assertEqual(self.clock.value, 10)
        self.assertEqual(self.terminated, 1)

    def test_cancel_prevents_an_old_shutdown_request_from_terminating(self):
        scheduler = self.scheduler(lambda _path: False)
        scheduler.schedule_if_idle()
        scheduler.cancel()
        run_timers(self.clock)
        self.assertEqual(self.terminated, 0)

    def test_registry_only_counts_live_integer_pids(self):
        with tempfile.TemporaryDirectory() as directory:
            registry_path = os.path.join(directory, 'instances.json')
            with open(registry_path, 'w', encoding='utf-8') as registry:
                json.dump([111, 'not-a-pid', 222], registry)
            self.assertTrue(active_electron_instances(registry_path, is_running=lambda pid: pid == 222))
            self.assertFalse(active_electron_instances(registry_path, is_running=lambda _pid: False))


if __name__ == '__main__':
    unittest.main()
