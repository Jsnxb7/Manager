#pragma once
#include "pch.h"
#include "NativeModules.h"
#include "CatalogStorage.h"
#include "WindowControls.h"
#include "mpv/client.h"
#include <atomic>
#include <cmath>
#include <mutex>
#include <algorithm>
#include <thread>

// The video is libmpv in a child window floated over the page's marker. mpv decodes
// everything it plays, renders styled ASS subtitles through libass, and draws its own
// on-screen controller, so the app adds no controls of its own on Windows.
// libmpv-2.dll is loaded at run time from beside the executable.
struct Mpv {
#define MPV_FN(name) decltype(&::name) name = nullptr;
  MPV_FN(mpv_create) MPV_FN(mpv_initialize) MPV_FN(mpv_terminate_destroy) MPV_FN(mpv_set_option_string)
  MPV_FN(mpv_command) MPV_FN(mpv_set_property) MPV_FN(mpv_set_property_string) MPV_FN(mpv_get_property)
  MPV_FN(mpv_observe_property) MPV_FN(mpv_wait_event) MPV_FN(mpv_set_wakeup_callback) MPV_FN(mpv_error_string)
  MPV_FN(mpv_free)
#undef MPV_FN
  bool loaded = false;
  void Load() {
    if (loaded) return;
    WCHAR path[MAX_PATH]; GetModuleFileNameW(nullptr, path, MAX_PATH);
    auto dll = fs::path(path).parent_path() / L"libmpv-2.dll";
    HMODULE module = LoadLibraryExW(dll.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!module) throw std::runtime_error("The video engine (libmpv-2.dll) is missing. Reinstall Anime Manager.");
    auto bind = [&](auto &slot, char const *name) {
      slot = reinterpret_cast<std::remove_reference_t<decltype(slot)>>(GetProcAddress(module, name));
      if (!slot) throw std::runtime_error(std::string("The video engine is incompatible: ") + name);
    };
    bind(mpv_create, "mpv_create"); bind(mpv_initialize, "mpv_initialize"); bind(mpv_terminate_destroy, "mpv_terminate_destroy");
    bind(mpv_set_option_string, "mpv_set_option_string"); bind(mpv_command, "mpv_command"); bind(mpv_set_property, "mpv_set_property");
    bind(mpv_set_property_string, "mpv_set_property_string"); bind(mpv_get_property, "mpv_get_property");
    bind(mpv_observe_property, "mpv_observe_property"); bind(mpv_wait_event, "mpv_wait_event");
    bind(mpv_set_wakeup_callback, "mpv_set_wakeup_callback"); bind(mpv_error_string, "mpv_error_string");
    bind(mpv_free, "mpv_free");
    loaded = true;
  }
};

REACT_MODULE(CatalogPlayer)
struct CatalogPlayer {
  using Promise = winrt::Microsoft::ReactNative::ReactPromise<std::string>;
  static constexpr UINT WM_MPV = WM_APP + 2;
  enum : uint64_t { kFullscreen = 1, kEnded = 2, kPause = 3 };
  winrt::Microsoft::ReactNative::ReactContext context;
  Mpv api;
  mpv_handle *mpv = nullptr;
  HWND window = nullptr;
  bool ready = false, ended = false, paused = true, closed = true, full = false, mini = false;
  bool navPrevious = false, navNext = false;
  RECT normalRect{}; LONG normalStyle = 0;
  std::wstring error, request;
  double placeX = 0, placeY = 0, placeW = 0, placeH = 0, clipTop = 0, clipBottom = 0;
  bool placeHidden = false;
  bool wantFocus = false;
  // Hover previews: a second, silent mpv in a small window the mouse passes through.
  mpv_handle *preview = nullptr;
  HWND previewWindow = nullptr;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept {
    context = value;
    g_closePlayer = [this]() { try { Close(); } catch (...) {} };
    g_closePlayerOwner = this;
  }
  ~CatalogPlayer() {
    if (g_closePlayerOwner == this) { g_closePlayer = nullptr; g_closePlayerOwner = nullptr; }
  }
  void Close() {
    ClosePreview();
    if (mini) ToggleMini();
    if (full) SetFullscreen(false);
    Shut();
    ready = false; closed = true;
  }

  static int Scale(HWND hwnd, int value) { return MulDiv(value, GetDpiForWindow(hwnd), 96); }
  void Check(int status) { if (status < 0) throw std::runtime_error(api.mpv_error_string(status)); }
  void Command(std::initializer_list<char const *> words) {
    std::vector<char const *> args(words); args.push_back(nullptr);
    Check(api.mpv_command(mpv, args.data()));
  }
  double Number(char const *name) {
    double value = 0;
    if (!mpv || api.mpv_get_property(mpv, name, MPV_FORMAT_DOUBLE, &value) < 0 || !std::isfinite(value)) return 0;
    return std::max(0.0, value);
  }
  std::string Text(char const *name) {
    char *value = nullptr;
    if (!mpv || api.mpv_get_property(mpv, name, MPV_FORMAT_STRING, &value) < 0 || !value) return {};
    std::string result(value);
    api.mpv_free(value);
    return result;
  }
  // The playing track as the app remembers it per title: lang:<code>, id:<n> or off.
  std::string Track(char const *kind, char const *property) {
    if (!mpv || !ready) return {};
    auto const id = Text(property);
    if (id.empty() || id == "no") return std::string(kind) == "sub" ? "off" : "";
    auto const lang = Text((std::string("current-tracks/") + kind + "/lang").c_str());
    return lang.empty() ? "id:" + id : "lang:" + lang;
  }
  void SetFlag(char const *name, bool on) { int flag = on; if (mpv) api.mpv_set_property(mpv, name, MPV_FORMAT_FLAG, &flag); }
  void SetNumber(char const *name, double value) { if (mpv) Check(api.mpv_set_property(mpv, name, MPV_FORMAT_DOUBLE, &value)); }

  // mpv creates its embedded window disabled, which sends every mouse event past it
  // to the host, so its controller never appears. Enabling it hands mpv the mouse.
  void EnableInput() {
    if (!window) return;
    HWND child = FindWindowExW(window, nullptr, L"mpv", nullptr);
    if (child && !IsWindowEnabled(child)) EnableWindow(child, TRUE);
    if (child && wantFocus) { SetFocus(child); wantFocus = false; }
  }
  // Keyboard focus belongs on mpv's own window, where its key bindings live.
  void FocusVideo() {
    HWND child = window ? FindWindowExW(window, nullptr, L"mpv", nullptr) : nullptr;
    if (child) SetFocus(child);
    else wantFocus = true;
  }
  // Ends the current video. mpv's shutdown waits for its render thread, which needs
  // this (UI) thread to take its window down, so waiting here could hang the app.
  // The window is detached and hidden at once; mpv stops on a worker thread, which
  // then has the window closed. The next video gets a fresh window.
  void Shut() {
    mpv_handle *const handle = mpv;
    HWND const hwnd = window;
    mpv = nullptr; window = nullptr;
    if (handle) api.mpv_set_wakeup_callback(handle, nullptr, nullptr);
    if (hwnd) { KillTimer(hwnd, 1); SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0); ShowWindow(hwnd, SW_HIDE); }
    if (!handle) { if (hwnd) DestroyWindow(hwnd); return; }
    auto const destroy = api.mpv_terminate_destroy;
    std::thread([destroy, handle, hwnd]() {
      destroy(handle);
      if (hwnd) PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }).detach();
  }
  static LRESULT CALLBACK PreviewProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    // The page under the preview keeps the mouse, so its hover state never flickers.
    if (message == WM_NCHITTEST) return HTTRANSPARENT;
    // Posted by the thread that finished shutting the preview's mpv down.
    if (message == WM_CLOSE) { DestroyWindow(hwnd); return 0; }
    if (message == WM_ERASEBKGND) { RECT area; GetClientRect(hwnd, &area); FillRect(reinterpret_cast<HDC>(wp), &area, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH))); return 1; }
    return DefWindowProcW(hwnd, message, wp, lp);
  }
  // mpv's shutdown waits on its render thread, which needs this (UI) thread to tear
  // down its window, so shutting it down here would hang the app. The preview hides
  // at once; mpv stops on a worker thread, which then has the window closed.
  void ClosePreview() {
    HWND const hwnd = previewWindow;
    mpv_handle *const handle = preview;
    preview = nullptr; previewWindow = nullptr;
    if (hwnd) ShowWindow(hwnd, SW_HIDE);
    if (!handle) { if (hwnd) DestroyWindow(hwnd); return; }
    auto const destroy = api.mpv_terminate_destroy;
    std::thread([destroy, handle, hwnd]() {
      destroy(handle);
      if (hwnd) PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }).detach();
  }
  void OpenPreview(Json::JsonObject const &args) {
    api.Load();
    ClosePreview();
    if (!g_mainWindow) return;
    static bool registered = false;
    if (!registered) {
      WNDCLASSW wc{}; wc.lpfnWndProc = PreviewProc; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"AnimeManagerPreview";
      wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)); RegisterClassW(&wc); registered = true;
    }
    double const scale = GetDpiForWindow(g_mainWindow) / 96.0;
    int const x = static_cast<int>(args.GetNamedNumber(L"x") * scale), y = static_cast<int>(args.GetNamedNumber(L"y") * scale);
    int const w = static_cast<int>(args.GetNamedNumber(L"width") * scale), h = static_cast<int>(args.GetNamedNumber(L"height") * scale);
    if (w <= 0 || h <= 0) return;
    previewWindow = CreateWindowExW(0, L"AnimeManagerPreview", L"", WS_CHILD | WS_CLIPCHILDREN | WS_BORDER, x, y, w, h, g_mainWindow, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!previewWindow) return;
    SetWindowPos(previewWindow, HWND_TOP, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    preview = api.mpv_create();
    if (!preview) { ClosePreview(); return; }
    auto option = [&](char const *name, std::string const &value) { api.mpv_set_option_string(preview, name, value.c_str()); };
    option("wid", std::to_string(reinterpret_cast<intptr_t>(previewWindow)));
    option("config", "no"); option("load-scripts", "no"); option("terminal", "no"); option("ytdl", "no");
    option("vo", "gpu-next"); option("hwdec", "auto-safe"); option("osc", "no"); option("osd-level", "0");
    option("aid", "no"); option("mute", "yes"); option("sid", "no"); option("loop-file", "inf"); option("keep-open", "no");
    option("input-default-bindings", "no"); option("input-vo-keyboard", "no"); option("input-cursor", "no"); option("cursor-autohide", "no");
    option("panscan", "1.0");
    double const start = args.GetNamedNumber(L"start", 0);
    if (start > 1) option("start", std::to_string(start));
    if (api.mpv_initialize(preview) < 0) { ClosePreview(); return; }
    auto uri = winrt::to_string(args.GetNamedString(L"uri"));
    if (uri.rfind("file://", 0) == 0) uri = uri.substr(7);
    std::replace(uri.begin(), uri.end(), '/', '\\');
    char const *load[] = {"loadfile", uri.c_str(), "replace", nullptr};
    api.mpv_command(preview, load);
  }
  // Keeps the video over the page's marker, cut off where it would cover the navigation.
  void Apply() {
    if (!window || !g_mainWindow || mini) return;
    RECT client{}; GetClientRect(g_mainWindow, &client);
    if (full) {
      SetWindowRgn(window, nullptr, TRUE);
      SetWindowPos(window, HWND_TOP, 0, 0, client.right, client.bottom, SWP_NOACTIVATE | SWP_SHOWWINDOW);
      return;
    }
    double const scale = GetDpiForWindow(g_mainWindow) / 96.0;
    int const x = static_cast<int>(placeX * scale), y = static_cast<int>(placeY * scale);
    int const w = static_cast<int>(placeW * scale), h = static_cast<int>(placeH * scale);
    int const top = std::max(0, static_cast<int>(clipTop * scale) - y);
    int const bottom = std::min(h, static_cast<int>(client.bottom - clipBottom * scale) - y);
    if (placeHidden || w <= 0 || h <= 0 || bottom <= top) { ShowWindow(window, SW_HIDE); return; }
    SetWindowPos(window, HWND_TOP, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetWindowRgn(window, top > 0 || bottom < h ? CreateRectRgn(0, top, w, bottom) : nullptr, TRUE);
  }
  // Picture in picture: the video leaves the page for a small window above other apps.
  void ToggleMini() {
    if (!window || full) return;
    if (!mini) {
      SetParent(window, nullptr);
      SetWindowLongPtrW(window, GWL_STYLE, WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN | WS_THICKFRAME);
      SetWindowRgn(window, nullptr, TRUE);
      MONITORINFO info{sizeof(info)}; GetMonitorInfoW(MonitorFromWindow(g_mainWindow, MONITOR_DEFAULTTONEAREST), &info);
      int const w = Scale(window, 480), h = Scale(window, 270), edge = Scale(window, 24);
      SetWindowPos(window, HWND_TOPMOST, info.rcWork.right - w - edge, info.rcWork.bottom - h - edge, w, h, SWP_FRAMECHANGED | SWP_SHOWWINDOW);
      mini = true;
    } else {
      mini = false;
      SetWindowPos(window, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      SetWindowLongPtrW(window, GWL_STYLE, WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN);
      SetParent(window, g_mainWindow);
      Apply();
    }
  }
  // mpv's own fullscreen does nothing for an embedded window, so the app window fills
  // the monitor and the video fills the app window. mpv's flag mirrors the result so
  // its controller shows the right button.
  void SetFullscreen(bool on) {
    if (!g_mainWindow || on == full) { SetFlag("fullscreen", full); return; }
    if (mini) ToggleMini();
    full = on;
    SetAppFullscreen(on);
    SetFlag("fullscreen", full);
    Apply();
    // The presenter resizes the window a moment later; fit the video again then.
    if (window) SetTimer(window, 1, 120, nullptr);
    FocusVideo();
  }
  // Runs on the UI thread whenever mpv signals that events are waiting.
  void Drain() {
    EnableInput();
    while (mpv) {
      mpv_event *event = api.mpv_wait_event(mpv, 0);
      if (event->event_id == MPV_EVENT_NONE) break;
      if (event->event_id == MPV_EVENT_FILE_LOADED) { ready = true; error.clear(); }
      else if (event->event_id == MPV_EVENT_END_FILE) {
        auto end = static_cast<mpv_event_end_file *>(event->data);
        if (end->reason == MPV_END_FILE_REASON_ERROR) error = std::wstring(L"Cannot play this video: ") + std::wstring(winrt::to_hstring(api.mpv_error_string(end->error)));
      } else if (event->event_id == MPV_EVENT_PROPERTY_CHANGE) {
        auto change = static_cast<mpv_event_property *>(event->data);
        if (change->format != MPV_FORMAT_FLAG) continue;
        bool const on = *static_cast<int *>(change->data) != 0;
        if (event->reply_userdata == kFullscreen && on != full) SetFullscreen(on);
        else if (event->reply_userdata == kEnded) ended = on;
        else if (event->reply_userdata == kPause) paused = on;
      } else if (event->event_id == MPV_EVENT_CLIENT_MESSAGE) {
        auto message = static_cast<mpv_event_client_message *>(event->data);
        if (message->num_args < 2 || std::string(message->args[0]) != "catalog") continue;
        std::string const what = message->args[1];
        if (what == "next" && navNext) request = L"next";
        else if (what == "previous" && navPrevious) request = L"previous";
        else if (what == "pip") ToggleMini();
        else if (what == "minimize" && g_mainWindow) ShowWindow(g_mainWindow, SW_MINIMIZE);
        // Posted, because reloading closes this player from inside its own event loop.
        else if (what == "reload") context.UIDispatcher().Post([]() noexcept { try { ReloadUi(); } catch (...) {} });
      } else if (event->event_id == MPV_EVENT_SHUTDOWN) { closed = true; }
    }
  }
  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    auto self = reinterpret_cast<CatalogPlayer *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) { self = static_cast<CatalogPlayer *>(reinterpret_cast<CREATESTRUCTW *>(lp)->lpCreateParams); SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self)); }
    if (!self) return DefWindowProcW(hwnd, message, wp, lp);
    try {
      if (message == WM_MPV) { self->Drain(); return 0; }
      if (message == WM_TIMER && wp == 1) { KillTimer(hwnd, 1); self->Apply(); return 0; }
      if (message == WM_SETFOCUS) { self->FocusVideo(); return 0; }
      if (message == WM_ERASEBKGND) { RECT area; GetClientRect(hwnd, &area); FillRect(reinterpret_cast<HDC>(wp), &area, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH))); return 1; }
      // Closing the picture-in-picture window returns the video to the page.
      if (message == WM_CLOSE && self->mini) { self->ToggleMini(); return 0; }
    } catch (...) { self->error = L"Player command failed"; }
    return DefWindowProcW(hwnd, message, wp, lp);
  }
  void Open(Json::JsonObject const &args) {
    api.Load();
    ClosePreview();
    if (mini) ToggleMini();
    if (full) SetFullscreen(false);
    Shut();
    if (!g_mainWindow) throw std::runtime_error("Main window is unavailable");
    if (!window) {
      WNDCLASSW wc{}; wc.lpfnWndProc = WindowProc; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"AnimeManagerVideo";
      wc.hCursor = LoadCursorW(nullptr, IDC_ARROW); wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
      RegisterClassW(&wc);
      window = CreateWindowExW(0, wc.lpszClassName, L"Anime Manager video", WS_CHILD | WS_CLIPCHILDREN, 0, 0, 640, 360, g_mainWindow, nullptr, wc.hInstance, this);
      if (!window) throw std::runtime_error("Could not create the video window");
    }
    Apply();
    ready = false; ended = false; paused = false; closed = false; error.clear(); request.clear();
    mpv = api.mpv_create();
    if (!mpv) throw std::runtime_error("Could not start the video engine");
    auto option = [&](char const *name, std::string const &value) { Check(api.mpv_set_option_string(mpv, name, value.c_str())); };
    option("wid", std::to_string(reinterpret_cast<intptr_t>(window)));
    // Only the app's settings apply; a separate mpv install's config and scripts stay out.
    // Only the app's settings apply; a separate mpv install's config and scripts stay out.
    option("config", "no"); option("load-scripts", "no"); option("terminal", "no"); option("ytdl", "no");
    option("vo", "gpu-next"); option("hwdec", "auto-safe");
    option("keep-open", "yes"); option("idle", "yes"); option("force-window", "yes");
    option("input-default-bindings", "yes"); option("input-vo-keyboard", "yes"); option("cursor-autohide", "1200");
    // mpv's built-in controller; it shows wherever the mouse moves over the video.
    option("osc", "yes"); option("osd-bar", "no");
    // Styled to the app: night-blue panel, ridge-blue progress, Fluent icons. Its
    // previous/next buttons follow the app's order (episodes, related seasons, queue).
    option("script-opts", "osc-layout=floating,osc-icon_style=fluent,osc-floatingwidth=820,osc-floatingalpha=40,"
                          "osc-floatingtitle=no,osc-seekbarstyle=knob,osc-seekbarhandlesize=0.75,osc-seekrangestyle=line,"
                          "osc-hidetimeout=1800,osc-fadeduration=160,osc-fadein=yes,osc-deadzonesize=0,osc-minmousemove=1,"
                          "osc-windowcontrols=no,osc-vidscale=no,osc-scalewindowed=1.1,osc-scalefullscreen=1.35,osc-valign=0.9,"
                          "osc-timetotal=yes,osc-tooltipborder=1,osc-chapter_fmt=no,osc-greenandgrumpy=yes,osc-sub_margins=yes,"
                          "osc-background_color=#0A131D,osc-timecode_color=#86B8DC,osc-title_color=#D6DADF,"
                          "osc-time_pos_color=#F1F3F5,osc-buttons_color=#E2E6EA,osc-small_buttonsL_color=#C9CFD5,"
                          "osc-small_buttonsR_color=#C9CFD5,osc-top_buttons_color=#C9CFD5,osc-held_element_color=#86B8DC,"
                          "osc-playlist_prev_mbtn_left_command=script-message catalog previous,"
                          "osc-playlist_next_mbtn_left_command=script-message catalog next,"
                          "osc-playlist_prev_mbtn_right_command=,osc-playlist_next_mbtn_right_command=");
    option("osd-font", "Bahnschrift"); option("osd-font-size", "28");
    option("sub-auto", "fuzzy"); option("sub-font", "Bahnschrift SemiBold"); option("sub-border-size", "2.6");
    option("volume-max", "150");
    // The title's remembered audio and subtitles: by language, else by track number.
    auto const remembered = [&](wchar_t const *key, char const *lang, char const *id) {
      auto const value = winrt::to_string(args.GetNamedString(key, L""));
      if (value == "off") option(id, "no");
      else if (value.rfind("lang:", 0) == 0 && value.size() > 5) option(lang, value.substr(5));
      else if (value.rfind("id:", 0) == 0 && value.size() > 3) option(id, value.substr(3));
    };
    remembered(L"audio", "alang", "aid");
    remembered(L"subtitle", "slang", "sid");
    double const resume = args.GetNamedNumber(L"position", 0);
    if (resume > 1) option("start", std::to_string(resume));
    Check(api.mpv_initialize(mpv));
    api.mpv_observe_property(mpv, kFullscreen, "fullscreen", MPV_FORMAT_FLAG);
    api.mpv_observe_property(mpv, kEnded, "eof-reached", MPV_FORMAT_FLAG);
    api.mpv_observe_property(mpv, kPause, "pause", MPV_FORMAT_FLAG);
    api.mpv_set_wakeup_callback(mpv, [](void *data) { PostMessageW(static_cast<HWND>(data), WM_MPV, 0, 0); }, window);
    // Previous and next follow the app's order (episodes, related seasons, queue).
    for (auto const &[key, action] : std::initializer_list<std::pair<char const *, char const *>>{
             {">", "script-message catalog next"}, {"<", "script-message catalog previous"},
             {"NEXT", "script-message catalog next"}, {"PREV", "script-message catalog previous"},
             {"Alt+p", "script-message catalog pip"}, {"MBTN_LEFT", "cycle pause"},
             {"ESC", "set fullscreen no"}, {"MBTN_BACK", "script-message catalog previous"},
             {"MBTN_FORWARD", "script-message catalog next"}, {"WHEEL_UP", "add volume 5"},
             {"WHEEL_DOWN", "add volume -5"}, {"UP", "add volume 5"}, {"DOWN", "add volume -5"},
             {"n", "script-message catalog next"}, {"p", "script-message catalog previous"},
             // The app's own shortcuts, for when the video has keyboard focus.
             {"F11", "cycle fullscreen"}, {"Ctrl+r", "script-message catalog reload"},
             {"Ctrl+m", "script-message catalog minimize"}})
      Command({"keybind", key, action});
    auto uri = winrt::to_string(args.GetNamedString(L"uri"));
    if (uri.rfind("file://", 0) == 0) uri = uri.substr(7);
    std::replace(uri.begin(), uri.end(), '/', '\\');
    Command({"loadfile", uri.c_str(), "replace"});
    if (!args.GetNamedString(L"title", L"").empty()) Check(api.mpv_set_property_string(mpv, "force-media-title", winrt::to_string(args.GetNamedString(L"title")).c_str()));
    FocusVideo();
  }
  Json::JsonObject State() {
    Json::JsonObject state;
    state.SetNamedValue(L"position", Json::JsonValue::CreateNumberValue(Number("time-pos")));
    state.SetNamedValue(L"duration", Json::JsonValue::CreateNumberValue(Number("duration")));
    state.SetNamedValue(L"paused", Json::JsonValue::CreateBooleanValue(!mpv || paused));
    state.SetNamedValue(L"ready", Json::JsonValue::CreateBooleanValue(ready));
    state.SetNamedValue(L"ended", Json::JsonValue::CreateBooleanValue(ended));
    state.SetNamedValue(L"closed", Json::JsonValue::CreateBooleanValue(closed));
    state.SetNamedValue(L"error", Json::JsonValue::CreateStringValue(error));
    state.SetNamedValue(L"request", Json::JsonValue::CreateStringValue(request));
    request.clear();
    // Track choice lives in mpv's controller; the page remembers it per title.
    state.SetNamedValue(L"audio", Json::JsonArray());
    state.SetNamedValue(L"subtitles", Json::JsonArray());
    state.SetNamedValue(L"audioTrack", Json::JsonValue::CreateStringValue(winrt::to_hstring(Track("audio", "aid"))));
    state.SetNamedValue(L"subtitleTrack", Json::JsonValue::CreateStringValue(winrt::to_hstring(Track("sub", "sid"))));
    return state;
  }
  REACT_METHOD(Execute, L"execute")
  void Execute(std::string method, std::string json, Promise promise) noexcept {
    context.UIDispatcher().Post([this, method, json, promise]() noexcept {
      try {
        auto args = Json::JsonObject::Parse(winrt::to_hstring(json));
        if (method == "place") {
          placeX = args.GetNamedNumber(L"x"); placeY = args.GetNamedNumber(L"y"); placeW = args.GetNamedNumber(L"width"); placeH = args.GetNamedNumber(L"height");
          clipTop = args.GetNamedNumber(L"clipTop"); clipBottom = args.GetNamedNumber(L"clipBottom"); placeHidden = args.GetNamedBoolean(L"hidden");
          Apply();
        } else if (method == "nav") { navPrevious = args.GetNamedBoolean(L"previous"); navNext = args.GetNamedBoolean(L"next"); }
        else if (method == "open") Open(args);
        else if (method == "state") { if (mpv) Drain(); }
        // The page's toasts cannot draw over this window, so mpv shows them instead.
        else if (method == "message") { if (mpv && ready) Command({"show-text", winrt::to_string(args.GetNamedString(L"text")).c_str(), "4000"}); }
        // A styled card drawn over the video (the up-next countdown); empty clears it.
        else if (method == "overlay") {
          if (mpv) {
            auto const ass = winrt::to_string(args.GetNamedString(L"ass", L""));
            if (ass.empty()) Command({"osd-overlay", "7", "none", ""});
            else Command({"osd-overlay", "7", "ass-events", ass.c_str(), "0", "720", "0", "no"});
          }
        }
        else if (method == "close") Close();
        else if (method == "previewOpen") OpenPreview(args);
        else if (method == "previewClose") ClosePreview();
        else {
          if (!mpv) throw std::runtime_error("Open a video first");
          if (method == "play") SetFlag("pause", false);
          else if (method == "pause") SetFlag("pause", true);
          else if (method == "seek") { Command({"seek", std::to_string(args.GetNamedNumber(L"position")).c_str(), "absolute+exact"}); ended = false; }
          else if (method == "volume") SetNumber("volume", std::clamp(args.GetNamedNumber(L"volume"), 0.0, 1.5) * 100);
          else if (method == "rate") SetNumber("speed", args.GetNamedNumber(L"rate"));
          else if (method == "show") { FocusVideo(); closed = false; }
          // Keys pressed while the page, not the video, has focus.
          else if (method == "key") Command({"keypress", winrt::to_string(args.GetNamedString(L"key")).c_str()});
          else if (method == "fullscreen") SetFullscreen(!full);
          else if (method == "pip") ToggleMini();
          else if (method == "importSubtitle") Command({"sub-add", CatalogStorage::Path(args.GetNamedString(L"uri")).string().c_str(), "select"});
          else if (method == "subtitle") Check(api.mpv_set_property_string(mpv, "sid", args.GetNamedString(L"id") == L"off" ? "no" : winrt::to_string(args.GetNamedString(L"id")).c_str()));
          else if (method == "audio") Check(api.mpv_set_property_string(mpv, "aid", winrt::to_string(args.GetNamedString(L"id")).c_str()));
          else throw std::runtime_error("Unknown player command");
        }
        promise.Resolve(winrt::to_string(State().Stringify()));
      } catch (std::exception const &error) { promise.Reject(error.what()); } catch (winrt::hresult_error const &error) { promise.Reject(error.message().c_str()); }
    });
  }
};
