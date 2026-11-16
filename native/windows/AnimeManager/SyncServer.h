#pragma once
#include "pch.h"
#include "NativeModules.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <bcrypt.h>
#include <atomic>
#include <condition_variable>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <fstream>
#include <vector>
#include <shlobj.h>
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "bcrypt.lib")

namespace Json = winrt::Windows::Data::Json;

// Sync with the phone (see src/services/sync). While sharing is on, a small HTTP
// server listens on 127.0.0.1 only, and ngrok forwards the PC's public domain to
// it. Requests go to JavaScript, which checks signatures and answers; nothing
// here touches the catalog. ngrok's own log tells the page when the tunnel is up
// or down, so nothing polls.
REACT_MODULE(SyncServer)
struct SyncServer {
  using Promise = winrt::Microsoft::ReactNative::ReactPromise<std::string>;
  static constexpr size_t kMaxHeader = 64 * 1024;
  static constexpr size_t kMaxBody = 32 * 1024 * 1024;

  winrt::Microsoft::ReactNative::ReactContext context;
  std::mutex lock;
  std::condition_variable answered;
  std::map<uint64_t, std::pair<int, std::string>> replies;
  std::atomic<uint64_t> nextId{1};
  std::atomic<bool> running{false};
  SOCKET listener = INVALID_SOCKET;
  std::thread server, reader;
  HANDLE job = nullptr, process = nullptr, output = nullptr;
  std::string url;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept { context = value; }
  ~SyncServer() { Stop(); }

  void Emit(wchar_t const *name, Json::JsonObject const &value) {
    context.EmitJSEvent(L"RCTDeviceEventEmitter", name, winrt::to_string(value.Stringify()));
  }
  void Availability(wchar_t const *state, std::wstring const &detail) {
    Json::JsonObject event;
    event.SetNamedValue(L"state", Json::JsonValue::CreateStringValue(state));
    event.SetNamedValue(L"url", Json::JsonValue::CreateStringValue(winrt::to_hstring(url)));
    event.SetNamedValue(L"reason", Json::JsonValue::CreateStringValue(detail));
    Emit(L"syncAvailability", event);
  }

  static std::string RandomKey() {
    uint8_t bytes[16];
    if (BCryptGenRandom(nullptr, bytes, sizeof(bytes), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0)
      throw std::runtime_error("Could not create a sync key");
    static char const digits[] = "0123456789abcdef";
    std::string key;
    for (uint8_t b : bytes) { key += digits[b >> 4]; key += digits[b & 15]; }
    return key;
  }

  // ---- HTTP server -------------------------------------------------------
  static bool ReadAll(SOCKET s, std::string &into, size_t want) {
    char buffer[16384];
    while (into.size() < want) {
      int got = recv(s, buffer, static_cast<int>(std::min(sizeof(buffer), want - into.size())), 0);
      if (got <= 0) return false;
      into.append(buffer, got);
    }
    return true;
  }
  static void Reply(SOCKET s, int status, std::string const &body) {
    char const *reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : status == 413 ? "Payload Too Large" : status == 503 ? "Service Unavailable" : status == 504 ? "Gateway Timeout" : "Error";
    std::string head = "HTTP/1.1 " + std::to_string(status) + " " + reason +
                       "\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + std::to_string(body.size()) +
                       "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
    head += body;
    size_t sent = 0;
    while (sent < head.size()) {
      int n = send(s, head.data() + sent, static_cast<int>(head.size() - sent), 0);
      if (n <= 0) break;
      sent += n;
    }
  }
  // Streams a file JavaScript has already checked (the phone's app update).
  static void SendFile(SOCKET s, std::string const &path) {
    std::ifstream file(winrt::to_hstring(path).c_str(), std::ios::binary);
    if (!file) return Reply(s, 404, "{\"error\":\"Update file missing\"}");
    file.seekg(0, std::ios::end);
    auto const size = static_cast<uint64_t>(file.tellg());
    file.seekg(0);
    std::string head = "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.android.package-archive\r\nContent-Length: " +
                       std::to_string(size) + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
    if (send(s, head.data(), static_cast<int>(head.size()), 0) <= 0) return;
    std::vector<char> buffer(256 * 1024);
    while (file) {
      file.read(buffer.data(), buffer.size());
      auto got = file.gcount();
      for (std::streamsize sent = 0; sent < got;) {
        int n = send(s, buffer.data() + sent, static_cast<int>(got - sent), 0);
        if (n <= 0) return;
        sent += n;
      }
    }
  }
  void Handle(SOCKET s) {
    DWORD timeout = 30000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<char const *>(&timeout), sizeof(timeout));
    std::string data;
    size_t end = std::string::npos;
    char buffer[4096];
    while ((end = data.find("\r\n\r\n")) == std::string::npos) {
      if (data.size() > kMaxHeader) return Reply(s, 413, "{\"error\":\"Header too large\"}");
      int got = recv(s, buffer, sizeof(buffer), 0);
      if (got <= 0) return;
      data.append(buffer, got);
    }
    std::string head = data.substr(0, end), body = data.substr(end + 4);
    size_t lineEnd = head.find("\r\n");
    std::string requestLine = head.substr(0, lineEnd);
    size_t sp1 = requestLine.find(' '), sp2 = requestLine.find(' ', sp1 + 1);
    if (sp1 == std::string::npos || sp2 == std::string::npos) return Reply(s, 400, "{\"error\":\"Bad request\"}");
    std::string method = requestLine.substr(0, sp1), path = requestLine.substr(sp1 + 1, sp2 - sp1 - 1);
    Json::JsonObject headers;
    size_t length = 0;
    for (size_t at = lineEnd + 2; at < head.size();) {
      size_t next = head.find("\r\n", at);
      if (next == std::string::npos) next = head.size();
      std::string line = head.substr(at, next - at);
      size_t colon = line.find(':');
      if (colon != std::string::npos) {
        std::string name = line.substr(0, colon), value = line.substr(colon + 1);
        while (!value.empty() && value.front() == ' ') value.erase(0, 1);
        for (auto &c : name) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
        headers.SetNamedValue(winrt::to_hstring(name), Json::JsonValue::CreateStringValue(winrt::to_hstring(value)));
        if (name == "content-length") length = std::strtoull(value.c_str(), nullptr, 10);
      }
      at = next + 2;
    }
    if (length > kMaxBody) return Reply(s, 413, "{\"error\":\"Request too large\"}");
    if (!ReadAll(s, body, length)) return;
    body.resize(length);
    uint64_t const id = nextId++;
    Json::JsonObject event;
    event.SetNamedValue(L"id", Json::JsonValue::CreateNumberValue(static_cast<double>(id)));
    event.SetNamedValue(L"method", Json::JsonValue::CreateStringValue(winrt::to_hstring(method)));
    event.SetNamedValue(L"path", Json::JsonValue::CreateStringValue(winrt::to_hstring(path)));
    event.SetNamedValue(L"headers", headers);
    event.SetNamedValue(L"body", Json::JsonValue::CreateStringValue(winrt::to_hstring(body)));
    Emit(L"syncRequest", event);
    std::unique_lock<std::mutex> guard(lock);
    if (!answered.wait_for(guard, std::chrono::seconds(30), [&] { return replies.count(id) > 0 || !running; }))
      return Reply(s, 504, "{\"error\":\"The PC app did not answer\"}");
    if (!replies.count(id)) return;
    auto reply = replies[id];
    replies.erase(id);
    guard.unlock();
    if (reply.first == 200 && reply.second.rfind("@file:", 0) == 0) return SendFile(s, reply.second.substr(6));
    Reply(s, reply.first, reply.second);
  }
  void Serve() {
    while (running) {
      SOCKET client = accept(listener, nullptr, nullptr);
      if (client == INVALID_SOCKET) break;
      try { Handle(client); } catch (...) {}
      shutdown(client, SD_SEND);
      closesocket(client);
    }
  }

  // ---- ngrok ---------------------------------------------------------------
  static std::wstring FindNgrok() {
    WCHAR found[MAX_PATH]{};
    if (SearchPathW(nullptr, L"ngrok.exe", nullptr, MAX_PATH, found, nullptr)) return found;
    PWSTR local = nullptr;
    std::wstring path;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) {
      path = std::wstring(local) + L"\\Microsoft\\WinGet\\Links\\ngrok.exe";
      CoTaskMemFree(local);
      if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) return path;
    }
    return L"";
  }
  void ReadNgrok() {
    std::string pending, lastError;
    char buffer[4096];
    DWORD got = 0;
    while (ReadFile(output, buffer, sizeof(buffer), &got, nullptr) && got) {
      pending.append(buffer, got);
      size_t line;
      while ((line = pending.find('\n')) != std::string::npos) {
        std::string text = pending.substr(0, line);
        pending.erase(0, line + 1);
        Json::JsonObject record{nullptr};
        if (!Json::JsonObject::TryParse(winrt::to_hstring(text), record)) continue;
        auto msg = winrt::to_string(record.GetNamedString(L"msg", L""));
        auto level = winrt::to_string(record.GetNamedString(L"lvl", L""));
        if (msg == "started tunnel") {
          url = winrt::to_string(record.GetNamedString(L"url", L""));
          Availability(L"online", L"");
        } else if (level == "eror" || level == "crit") {
          lastError = winrt::to_string(record.GetNamedString(L"err", record.GetNamedString(L"msg", L"")));
        }
      }
    }
    // The pipe closes when ngrok exits, for whatever reason.
    url.clear();
    if (running) Availability(L"offline", winrt::to_hstring(lastError.empty() ? "ngrok stopped" : lastError).c_str());
  }

  void Start(int port, std::wstring const &domain) {
    Stop();
    std::wstring const ngrok = FindNgrok();
    if (ngrok.empty()) throw std::runtime_error("ngrok is not installed. Install it (winget install ngrok.ngrok) and run: ngrok config add-authtoken <token>");
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<u_short>(port));
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    if (listener == INVALID_SOCKET || bind(listener, reinterpret_cast<sockaddr *>(&address), sizeof(address)) != 0 || listen(listener, 4) != 0) {
      if (listener != INVALID_SOCKET) closesocket(listener);
      listener = INVALID_SOCKET;
      throw std::runtime_error("Port " + std::to_string(port) + " is in use; choose another sync port");
    }
    running = true;
    server = std::thread([this] { Serve(); });

    // ngrok ends with the app: it lives in a job that closes with this process.
    job = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    SECURITY_ATTRIBUTES inherit{sizeof(inherit), nullptr, TRUE};
    HANDLE readEnd = nullptr, writeEnd = nullptr;
    CreatePipe(&readEnd, &writeEnd, &inherit, 0);
    SetHandleInformation(readEnd, HANDLE_FLAG_INHERIT, 0);
    STARTUPINFOW startup{sizeof(startup)};
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdOutput = writeEnd;
    startup.hStdError = writeEnd;
    PROCESS_INFORMATION info{};
    std::wstring command = L"\"" + ngrok + L"\" http 127.0.0.1:" + std::to_wstring(port) + L" --url=" + domain + L" --log=stdout --log-format=json";
    BOOL const ok = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, nullptr, &startup, &info);
    CloseHandle(writeEnd);
    if (!ok) { CloseHandle(readEnd); Stop(); throw std::runtime_error("Could not start ngrok"); }
    AssignProcessToJobObject(job, info.hProcess);
    ResumeThread(info.hThread);
    CloseHandle(info.hThread);
    process = info.hProcess;
    output = readEnd;
    reader = std::thread([this] { ReadNgrok(); });
  }
  void Stop() {
    bool const was = running.exchange(false);
    answered.notify_all();
    if (listener != INVALID_SOCKET) { closesocket(listener); listener = INVALID_SOCKET; }
    if (process) { TerminateProcess(process, 0); }
    if (server.joinable()) server.join();
    if (reader.joinable()) reader.join();
    if (process) { CloseHandle(process); process = nullptr; }
    if (output) { CloseHandle(output); output = nullptr; }
    if (job) { CloseHandle(job); job = nullptr; }
    url.clear();
    if (was) Availability(L"offline", L"Sharing turned off");
  }

  REACT_METHOD(Execute, L"execute")
  void Execute(std::string method, std::string json, Promise promise) noexcept {
    // Start and stop wait on threads, so they run off the UI thread.
    std::thread([this, method, json, promise]() noexcept {
      try {
        auto args = Json::JsonObject::Parse(winrt::to_hstring(json));
        Json::JsonObject result;
        if (method == "randomKey") {
          result.SetNamedValue(L"key", Json::JsonValue::CreateStringValue(winrt::to_hstring(RandomKey())));
        } else if (method == "start") {
          Start(static_cast<int>(args.GetNamedNumber(L"port", 47820)), std::wstring(args.GetNamedString(L"domain")));
        } else if (method == "stop") {
          Stop();
        } else if (method == "respond") {
          {
            std::lock_guard<std::mutex> guard(lock);
            replies[static_cast<uint64_t>(args.GetNamedNumber(L"id"))] = {static_cast<int>(args.GetNamedNumber(L"status")), winrt::to_string(args.GetNamedString(L"body"))};
          }
          answered.notify_all();
        } else if (method != "status") {
          throw std::runtime_error("Unknown sync command");
        }
        result.SetNamedValue(L"sharing", Json::JsonValue::CreateBooleanValue(running));
        result.SetNamedValue(L"url", Json::JsonValue::CreateStringValue(winrt::to_hstring(url)));
        promise.Resolve(winrt::to_string(result.Stringify()));
      } catch (std::exception const &error) {
        promise.Reject(error.what());
      } catch (winrt::hresult_error const &error) {
        promise.Reject(error.message().c_str());
      }
    }).detach();
  }
};
