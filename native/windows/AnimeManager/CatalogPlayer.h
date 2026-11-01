#pragma once
#include "pch.h"
#include "NativeModules.h"
#include "CatalogStorage.h"
#include "WindowControls.h"
// windows.h maps this name to GetTickCount, which would rename the engine method.
#ifdef GetCurrentTime
#undef GetCurrentTime
#endif
#include <mfapi.h>
#include <mferror.h>
#include <mfmediaengine.h>
#include <dxgiformat.h>
#include <propidl.h>
#include <commctrl.h>
#include <atomic>
#include <cmath>
#include <mutex>
#include <regex>
#include <algorithm>

// A child window over the page avoids dependency on a Paper-only React view in a Fabric host.
// The Media Engine draws through Direct3D 11; the older MFPlay renderer crashed in D3D9.
REACT_MODULE(CatalogPlayer)
struct CatalogPlayer {
  using Promise = winrt::Microsoft::ReactNative::ReactPromise<std::string>;
  winrt::Microsoft::ReactNative::ReactContext context;
  winrt::com_ptr<IMFMediaEngineEx> player;
  HWND window = nullptr, video = nullptr, caption = nullptr;
  std::atomic<bool> ready{false}, ended{false};
  bool closed = true, full = false, captions = true;
  std::atomic<bool> started{false};
  double resume = 0;
  RECT normalRect{}; LONG normalStyle = 0;
  std::wstring error;
  struct Cue { double start, end; std::wstring text; };
  std::vector<Cue> cues;
  std::mutex mutex;
  double placeX = 0, placeY = 0, placeW = 0, placeH = 0, clipTop = 0, clipBottom = 0;
  bool placeHidden = false;
  HWND bar = nullptr;
  int barHover = -1;
  bool dragging = false, navPrevious = false, navNext = false;
  double dragTime = 0;
  ULONGLONG lastMove = 0;
  std::wstring request;
  bool mini = false;
  HWND tips = nullptr;
  struct Notify : winrt::implements<Notify, IMFMediaEngineNotify> {
    std::atomic<CatalogPlayer *> owner;
    explicit Notify(CatalogPlayer *value) : owner(value) {}
    HRESULT STDMETHODCALLTYPE EventNotify(DWORD event, DWORD_PTR, DWORD) noexcept override {
      auto self = owner.load();
      if (!self) return S_OK;
      try {
        if (event == MF_MEDIA_ENGINE_EVENT_ERROR) { std::lock_guard<std::mutex> lock(self->mutex); self->error = L"Cannot decode this video. Check the file and installed codecs."; }
        else if (event == MF_MEDIA_ENGINE_EVENT_ENDED) self->ended = true;
        else if (event == MF_MEDIA_ENGINE_EVENT_LOADEDMETADATA) { self->ready = true; PostMessageW(self->window, WM_APP + 1, 0, 0); }
        else if (event == MF_MEDIA_ENGINE_EVENT_CANPLAY && !self->started.exchange(true)) {
          auto engine = self->player;
          if (engine) { self->Seek(std::min(self->resume, std::max(0.0, self->Time(true) - 1))); engine->Play(); }
        }
      } catch (...) { std::lock_guard<std::mutex> lock(self->mutex); self->error = L"Could not start playback at the saved position"; }
      return S_OK;
    }
  };
  winrt::com_ptr<Notify> notify;
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept { context = value; }
  void Fit() {
    if (!player || !video || !window) return;
    // Keep the picture's shape, centred on black, when the page gives a differently shaped area.
    RECT area{}; GetClientRect(window, &area);
    DWORD sourceW = 0, sourceH = 0;
    if (SUCCEEDED(player->GetNativeVideoSize(&sourceW, &sourceH)) && sourceW && sourceH && area.right && area.bottom) {
      int width = area.right, height = MulDiv(width, sourceH, sourceW);
      if (height > area.bottom) { height = area.bottom; width = MulDiv(height, sourceW, sourceH); }
      area = {(area.right - width) / 2, (area.bottom - height) / 2, (area.right - width) / 2 + width, (area.bottom - height) / 2 + height};
    }
    MoveWindow(video, area.left, area.top, area.right - area.left, area.bottom - area.top, TRUE);
    RECT picture{0, 0, area.right - area.left, area.bottom - area.top};
    player->UpdateVideoStream(nullptr, &picture, nullptr);
  }
  void Shut() {
    if (notify) notify->owner = nullptr;
    if (player) { player->Shutdown(); player = nullptr; }
    notify = nullptr;
  }
  void Toggle() { if (!player) return; if (player->IsPaused()) player->Play(); else player->Pause(); }
  void Seek(double seconds) {
    if (!player || !std::isfinite(seconds)) return;
    winrt::check_hresult(player->SetCurrentTime(std::max(0.0, seconds))); ended = false;
  }
  double Time(bool duration = false) {
    if (!player) return 0;
    double result = duration ? player->GetDuration() : player->GetCurrentTime();
    return std::isfinite(result) ? std::max(0.0, result) : 0;
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
    SetWindowRgn(window, CreateRectRgn(0, top, w, bottom), TRUE);
  }
  // Picture in picture: the video leaves the page for a small window above other apps.
  void ToggleMini() {
    if (!window || full) return;
    if (!mini) {
      SetParent(window, nullptr);
      SetWindowLongPtrW(window, GWL_STYLE, WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN);
      SetWindowRgn(window, nullptr, TRUE);
      MONITORINFO info{sizeof(info)}; GetMonitorInfoW(MonitorFromWindow(g_mainWindow, MONITOR_DEFAULTTONEAREST), &info);
      int const w = BarScale(window, 480), h = BarScale(window, 270), edge = BarScale(window, 24);
      SetWindowPos(window, HWND_TOPMOST, info.rcWork.right - w - edge, info.rcWork.bottom - h - edge, w, h, SWP_FRAMECHANGED | SWP_SHOWWINDOW);
      mini = true;
    } else {
      mini = false;
      SetWindowPos(window, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      SetWindowLongPtrW(window, GWL_STYLE, WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN);
      SetParent(window, g_mainWindow);
      Apply();
    }
    SetFocus(window);
  }
  void ToggleFullscreen() {
    if (!g_mainWindow) return;
    if (mini) ToggleMini();
    if (!full) { GetWindowRect(g_mainWindow, &normalRect); normalStyle = GetWindowLongW(g_mainWindow, GWL_STYLE); SetWindowLongW(g_mainWindow, GWL_STYLE, WS_POPUP | WS_VISIBLE); MONITORINFO info{sizeof(info)}; GetMonitorInfoW(MonitorFromWindow(g_mainWindow, MONITOR_DEFAULTTONEAREST), &info); SetWindowPos(g_mainWindow, HWND_TOP, info.rcMonitor.left, info.rcMonitor.top, info.rcMonitor.right-info.rcMonitor.left, info.rcMonitor.bottom-info.rcMonitor.top, SWP_FRAMECHANGED); }
    else { SetWindowLongW(g_mainWindow,GWL_STYLE,normalStyle);SetWindowPos(g_mainWindow,nullptr,normalRect.left,normalRect.top,normalRect.right-normalRect.left,normalRect.bottom-normalRect.top,SWP_FRAMECHANGED|SWP_NOZORDER); }
    full = !full;
    Apply();
    if (window) SetFocus(window);
  }
  // The control bar: 0 previous, 1 back 10s, 2 play, 3 forward 10s, 4 next, 5 mute, 6 fullscreen, 7 seek track, 8 picture in picture.
  static int BarScale(HWND hwnd, int value) { return MulDiv(value, GetDpiForWindow(hwnd), 96); }
  RECT BarSlot(int slot, RECT const &area) const {
    int const size = BarScale(bar, 44);
    if (slot <= 4) return {size * slot + BarScale(bar, 6), 0, size * (slot + 1) + BarScale(bar, 6), area.bottom};
    if (slot == 8) return {area.right - size * 3 - BarScale(bar, 6), 0, area.right - size * 2 - BarScale(bar, 6), area.bottom};
    if (slot <= 6) return {area.right - size * (7 - slot) - BarScale(bar, 6), 0, area.right - size * (6 - slot) - BarScale(bar, 6), area.bottom};
    int const label = BarScale(bar, 70);
    return {size * 5 + BarScale(bar, 6) + label, 0, area.right - size * 3 - BarScale(bar, 6) - label, area.bottom};
  }
  int BarHit(int x, int y) const {
    RECT area{}; GetClientRect(bar, &area);
    POINT point{x, y};
    for (int slot = 0; slot < 9; slot++) { RECT rect = BarSlot(slot, area); if (PtInRect(&rect, point)) return slot; }
    return -1;
  }
  double BarTime(int x) const {
    RECT area{}; GetClientRect(bar, &area);
    RECT track = BarSlot(7, area);
    double const share = std::clamp(static_cast<double>(x - track.left) / std::max(1L, track.right - track.left), 0.0, 1.0);
    return share * const_cast<CatalogPlayer *>(this)->Time(true);
  }
  static std::wstring Clock(double seconds) {
    int const total = static_cast<int>(std::max(0.0, seconds));
    wchar_t text[32];
    if (total >= 3600) swprintf_s(text, L"%d:%02d:%02d", total / 3600, total / 60 % 60, total % 60);
    else swprintf_s(text, L"%d:%02d", total / 60, total % 60);
    return text;
  }
  void BarPress(int slot) {
    if (slot == 0 && navPrevious) request = L"previous";
    else if (slot == 1) Seek(std::max(0.0, Time() - 10));
    else if (slot == 2) Toggle();
    else if (slot == 3) Seek(std::min(Time(true), Time() + 10));
    else if (slot == 4 && navNext) request = L"next";
    else if (slot == 5 && player) player->SetMuted(!player->GetMuted());
    else if (slot == 6) ToggleFullscreen();
    else if (slot == 8) ToggleMini();
    if (window) SetFocus(window);
    InvalidateRect(bar, nullptr, FALSE);
  }
  void BarPaint(HWND hwnd) {
    PAINTSTRUCT paint; HDC target = BeginPaint(hwnd, &paint);
    RECT area{}; GetClientRect(hwnd, &area);
    HDC dc = CreateCompatibleDC(target);
    HBITMAP bitmap = CreateCompatibleBitmap(target, area.right, area.bottom);
    auto previousBitmap = SelectObject(dc, bitmap);
    auto fill = [&](RECT const &rect, COLORREF color) { HBRUSH brush = CreateSolidBrush(color); FillRect(dc, &rect, brush); DeleteObject(brush); };
    fill(area, RGB(10, 19, 29));
    SetBkMode(dc, TRANSPARENT);
    HFONT icons = CreateFontW(-BarScale(hwnd, 16), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe MDL2 Assets");
    HFONT label = CreateFontW(-BarScale(hwnd, 13), 0, 0, 0, FW_SEMIBOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Bahnschrift");
    bool const muted = player && player->GetMuted(), paused = !player || player->IsPaused();
    wchar_t const *glyphs[] = {L"\xE892", L"", L"", L"", L"\xE893", L"", L""};
    std::wstring play = paused ? L"\xE768" : L"\xE769", sound = muted ? L"\xE74F" : L"\xE767", screen = full ? L"\xE73F" : L"\xE740";
    for (int slot : {0, 1, 2, 3, 4, 5, 6, 8}) {
      RECT rect = BarSlot(slot, area);
      bool const off = (slot == 0 && !navPrevious) || (slot == 4 && !navNext);
      if (barHover == slot && !off) { RECT lit = rect; InflateRect(&lit, -BarScale(hwnd, 3), -BarScale(hwnd, 6)); fill(lit, RGB(37, 54, 74)); }
      SetTextColor(dc, off ? RGB(62, 72, 84) : barHover == slot ? RGB(134, 184, 220) : RGB(214, 218, 223));
      std::wstring text = slot == 1 ? L"-10" : slot == 3 ? L"+10" : slot == 2 ? play : slot == 5 ? sound : slot == 6 ? screen : slot == 8 ? (mini ? L"\xE93B" : L"\xE93A") : glyphs[slot];
      SelectObject(dc, slot == 1 || slot == 3 ? label : icons);
      DrawTextW(dc, text.c_str(), -1, &rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    }
    double const duration = Time(true), position = dragging ? dragTime : Time();
    RECT track = BarSlot(7, area);
    SelectObject(dc, label); SetTextColor(dc, RGB(139, 146, 153));
    RECT left{track.left - BarScale(hwnd, 66), 0, track.left - BarScale(hwnd, 8), area.bottom}, right{track.right + BarScale(hwnd, 8), 0, track.right + BarScale(hwnd, 66), area.bottom};
    DrawTextW(dc, Clock(position).c_str(), -1, &left, DT_RIGHT | DT_VCENTER | DT_SINGLELINE);
    DrawTextW(dc, Clock(duration).c_str(), -1, &right, DT_LEFT | DT_VCENTER | DT_SINGLELINE);
    int const middle = area.bottom / 2, thick = BarScale(hwnd, barHover == 7 || dragging ? 3 : 2);
    fill({track.left, middle - thick, track.right, middle + thick}, RGB(42, 58, 75));
    int const done = track.left + static_cast<int>((track.right - track.left) * (duration > 0 ? std::clamp(position / duration, 0.0, 1.0) : 0));
    fill({track.left, middle - thick, done, middle + thick}, RGB(134, 184, 220));
    if (barHover == 7 || dragging) { int const knob = BarScale(hwnd, 6); fill({done - knob / 2, middle - knob, done + knob / 2, middle + knob}, RGB(214, 218, 223)); }
    BitBlt(target, 0, 0, area.right, area.bottom, dc, 0, 0, SRCCOPY);
    SelectObject(dc, previousBitmap); DeleteObject(bitmap); DeleteObject(icons); DeleteObject(label); DeleteDC(dc);
    EndPaint(hwnd, &paint);
  }
  // The hovered control's full name, in the system tooltip.
  void UpdateTip() {
    if (!tips || !bar) return;
    bool const paused = !player || player->IsPaused(), muted = player && player->GetMuted();
    std::wstring name = barHover == 0 ? L"Previous" : barHover == 1 ? L"Back 10 seconds" : barHover == 2 ? (paused ? L"Play" : L"Pause") : barHover == 3 ? L"Forward 10 seconds" : barHover == 4 ? L"Next" : barHover == 5 ? (muted ? L"Unmute" : L"Mute") : barHover == 6 ? (full ? L"Exit fullscreen" : L"Fullscreen") : barHover == 7 ? L"Seek" : barHover == 8 ? (mini ? L"Back to the page" : L"Picture in picture") : L"";
    TOOLINFOW tool{};tool.cbSize = sizeof(tool);tool.hwnd = bar;tool.uId = 1;tool.lpszText = name.data();
    GetClientRect(bar, &tool.rect);
    SendMessageW(tips, TTM_UPDATETIPTEXTW, 0, reinterpret_cast<LPARAM>(&tool));
    SendMessageW(tips, TTM_NEWTOOLRECTW, 0, reinterpret_cast<LPARAM>(&tool));
    SendMessageW(tips, TTM_ACTIVATE, !name.empty(), 0);
  }
  static LRESULT CALLBACK BarProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    auto self = reinterpret_cast<CatalogPlayer *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) { self = static_cast<CatalogPlayer *>(reinterpret_cast<CREATESTRUCTW *>(lp)->lpCreateParams); SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self)); }
    if (!self) return DefWindowProcW(hwnd, message, wp, lp);
    try {
      int const x = static_cast<short>(LOWORD(lp)), y = static_cast<short>(HIWORD(lp));
      if (message == WM_ERASEBKGND) return 1;
      if (message == WM_PAINT) { self->BarPaint(hwnd); return 0; }
      if (message == WM_MOUSEMOVE) {
        self->lastMove = GetTickCount64();
        TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, hwnd, 0}; TrackMouseEvent(&track);
        if (self->dragging) self->dragTime = self->BarTime(x);
        int const hit = self->BarHit(x, y);
        if (hit != self->barHover || self->dragging) { self->barHover = hit; InvalidateRect(hwnd, nullptr, FALSE); self->UpdateTip(); }
        if (self->tips) { MSG relay{hwnd, message, wp, lp}; SendMessageW(self->tips, TTM_RELAYEVENT, 0, reinterpret_cast<LPARAM>(&relay)); }
        return 0;
      }
      if (message == WM_MOUSELEAVE) { self->barHover = -1; InvalidateRect(hwnd, nullptr, FALSE); return 0; }
      if (message == WM_LBUTTONDOWN) {
        int const hit = self->BarHit(x, y);
        if (hit == 7) { self->dragging = true; self->dragTime = self->BarTime(x); SetCapture(hwnd); InvalidateRect(hwnd, nullptr, FALSE); }
        else if (hit >= 0) self->BarPress(hit);
        return 0;
      }
      if (message == WM_LBUTTONUP && self->dragging) { self->dragging = false; ReleaseCapture(); self->Seek(self->dragTime); if (self->window) SetFocus(self->window); return 0; }
    } catch (...) { self->error = L"Player command failed"; }
    return DefWindowProcW(hwnd, message, wp, lp);
  }
  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    auto self = reinterpret_cast<CatalogPlayer *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) { self = static_cast<CatalogPlayer *>(reinterpret_cast<CREATESTRUCTW *>(lp)->lpCreateParams); SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self)); }
    if (!self) return DefWindowProcW(hwnd,message,wp,lp);
    try {
      if (message == WM_SIZE) { auto w=LOWORD(lp),h=HIWORD(lp);int const barHeight=BarScale(hwnd,52);if(self->bar)MoveWindow(self->bar,0,std::max(0,static_cast<int>(h)-barHeight),w,barHeight,TRUE);MoveWindow(self->caption,8,std::max(0,static_cast<int>(h)-barHeight-54),std::max(1,static_cast<int>(w)-16),50,TRUE);self->Fit();return 0; }
      if (message == WM_MOUSEMOVE) { self->lastMove=GetTickCount64();if(self->bar&&!IsWindowVisible(self->bar))ShowWindow(self->bar,SW_SHOWNA);return 0; }
      if (message == WM_TIMER) { if(self->bar){POINT cursor;GetCursorPos(&cursor);RECT area;GetWindowRect(self->bar,&area);bool const over=IsWindowVisible(self->bar)&&PtInRect(&area,cursor);if(!self->dragging&&!over&&self->player&&!self->player->IsPaused()&&GetTickCount64()-self->lastMove>3000)ShowWindow(self->bar,SW_HIDE);else if(self->player&&self->player->IsPaused()&&!IsWindowVisible(self->bar))ShowWindow(self->bar,SW_SHOWNA);if(IsWindowVisible(self->bar))InvalidateRect(self->bar,nullptr,FALSE);}return 0; }
      if (message == WM_APP + 1) { self->Fit();return 0; }
      if (message == WM_LBUTTONDOWN) { SetFocus(hwnd);self->Toggle();return 0; }
      if (message == WM_LBUTTONDBLCLK) { self->ToggleFullscreen();return 0; }
      if(message==WM_CTLCOLORSTATIC){auto dc=reinterpret_cast<HDC>(wp);SetTextColor(dc,RGB(241,243,245));SetBkColor(dc,RGB(36,38,41));static HBRUSH brush=CreateSolidBrush(RGB(36,38,41));return reinterpret_cast<LRESULT>(brush);}
      if (message == WM_COMMAND) { if(LOWORD(wp)==1)self->Toggle();else if(LOWORD(wp)==2)self->Seek(std::max(0.0,self->Time()-10));else if(LOWORD(wp)==3)self->Seek(std::min(self->Time(true),self->Time()+10));else if(LOWORD(wp)==4)self->ToggleFullscreen();return 0; }
      if (message == WM_KEYDOWN && self->player) { if(wp==VK_ESCAPE&&self->full){self->ToggleFullscreen();return 0;}if(wp==VK_SPACE){if(!(lp & (1LL<<30)))SendMessageW(hwnd,WM_COMMAND,1,0);return 0;}if(wp==VK_LEFT)self->Seek(std::max(0.0,self->Time()-10));else if(wp==VK_RIGHT)self->Seek(std::min(self->Time(true),self->Time()+10));else if(wp=='F'&&!(lp&(1LL<<30)))self->ToggleFullscreen();else if(wp=='M'&&!(lp&(1LL<<30))){self->player->SetMuted(!self->player->GetMuted());}else if(wp==VK_UP||wp==VK_DOWN){self->player->SetVolume(std::clamp(self->player->GetVolume()+(wp==VK_UP?0.1:-0.1),0.0,1.0));}else return DefWindowProcW(hwnd,message,wp,lp);return 0; }
    } catch (...) { self->error=L"Player command failed"; }
    return DefWindowProcW(hwnd,message,wp,lp);
  }
  void Open(Json::JsonObject const &args) {
    if(mini)ToggleMini();
    if(full)ToggleFullscreen();
    Shut();
    std::lock_guard<std::mutex> lock(mutex);
    if(window){DestroyWindow(window);window=nullptr;bar=nullptr;}
    WNDCLASSW wc{};wc.style=CS_DBLCLKS;wc.lpfnWndProc=WindowProc;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"AnimeManagerVideo";wc.hbrBackground=static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));RegisterClassW(&wc);
    if(!g_mainWindow)throw std::runtime_error("Main window is unavailable");
    window=CreateWindowExW(0,wc.lpszClassName,L"",WS_CHILD|WS_CLIPCHILDREN,0,0,640,360,g_mainWindow,nullptr,wc.hInstance,this);
    if(!window)throw std::runtime_error("Could not create native video window");
    video=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,0,0,640,360,window,nullptr,wc.hInstance,nullptr);
    caption=CreateWindowExW(WS_EX_LAYERED,L"STATIC",L"",WS_CHILD|WS_CLIPSIBLINGS|SS_CENTER,8,300,620,50,window,nullptr,wc.hInstance,nullptr);
    SetLayeredWindowAttributes(caption,0,235,LWA_ALPHA);
    WNDCLASSW barClass{};barClass.lpfnWndProc=BarProc;barClass.hInstance=wc.hInstance;barClass.lpszClassName=L"AnimeManagerVideoBar";barClass.hCursor=LoadCursorW(nullptr,IDC_ARROW);RegisterClassW(&barClass);
    // The app window has no GDI surface of its own, so drawn children must be layered.
    bar=CreateWindowExW(WS_EX_LAYERED,barClass.lpszClassName,L"",WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,0,300,640,60,window,nullptr,wc.hInstance,this);
    SetLayeredWindowAttributes(bar,0,240,LWA_ALPHA);
    tips=CreateWindowExW(WS_EX_TOPMOST,TOOLTIPS_CLASSW,nullptr,WS_POPUP|TTS_ALWAYSTIP|TTS_NOPREFIX,0,0,0,0,bar,nullptr,wc.hInstance,nullptr);
    if(tips){TOOLINFOW tool{};tool.cbSize=sizeof(tool);tool.uFlags=TTF_SUBCLASS;tool.hwnd=bar;tool.uId=1;tool.lpszText=const_cast<wchar_t*>(L"");GetClientRect(bar,&tool.rect);SendMessageW(tips,TTM_ADDTOOLW,0,reinterpret_cast<LPARAM>(&tool));}
    SetWindowPos(bar,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
    lastMove=GetTickCount64();SetTimer(window,1,250,nullptr);
    Apply();
    ready=false;ended=false;closed=false;full=false;error.clear();cues.clear();resume=args.GetNamedNumber(L"position",0);
    started=false;
    static HRESULT const startup=MFStartup(MF_VERSION);winrt::check_hresult(startup);
    notify=winrt::make_self<Notify>(this);
    winrt::com_ptr<IMFAttributes> attributes;winrt::check_hresult(MFCreateAttributes(attributes.put(),3));
    winrt::check_hresult(attributes->SetUnknown(MF_MEDIA_ENGINE_CALLBACK,notify.as<IMFMediaEngineNotify>().get()));
    winrt::check_hresult(attributes->SetUINT64(MF_MEDIA_ENGINE_PLAYBACK_HWND,reinterpret_cast<UINT64>(video)));
    winrt::check_hresult(attributes->SetUINT32(MF_MEDIA_ENGINE_VIDEO_OUTPUT_FORMAT,DXGI_FORMAT_B8G8R8A8_UNORM));
    winrt::com_ptr<IMFMediaEngineClassFactory> factory;winrt::check_hresult(CoCreateInstance(CLSID_MFMediaEngineClassFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(factory.put())));
    winrt::com_ptr<IMFMediaEngine> engine;winrt::check_hresult(factory->CreateInstance(0,attributes.get(),engine.put()));
    player=engine.as<IMFMediaEngineEx>();
    auto uri=std::wstring(args.GetNamedString(L"uri"));if(uri.rfind(L"file://",0)==0)uri=uri.substr(7);std::replace(uri.begin(),uri.end(),L'/',L'\\');
    BSTR source=SysAllocString(uri.c_str());auto opened=player->SetSource(source);SysFreeString(source);winrt::check_hresult(opened);
  }
  Json::JsonArray AudioTracks() {
    Json::JsonArray tracks; if(!player||!ready)return tracks;
    DWORD count=0;player->GetNumberOfStreams(&count);
    for(DWORD i=0;i<count;i++){PROPVARIANT type;PropVariantInit(&type);if(SUCCEEDED(player->GetStreamAttribute(i,MF_MT_MAJOR_TYPE,&type))&&type.vt==VT_CLSID&&*type.puuid==MFMediaType_Audio){Json::JsonObject row;row.SetNamedValue(L"id",Json::JsonValue::CreateStringValue(std::to_wstring(i)));row.SetNamedValue(L"label",Json::JsonValue::CreateStringValue(L"Audio "+std::to_wstring(tracks.Size()+1)));tracks.Append(row);}PropVariantClear(&type);}return tracks;
  }
  Json::JsonObject State() {
    std::lock_guard<std::mutex> lock(mutex);Json::JsonObject state;auto position=Time();
    state.SetNamedValue(L"position",Json::JsonValue::CreateNumberValue(position));state.SetNamedValue(L"duration",Json::JsonValue::CreateNumberValue(Time(true)));state.SetNamedValue(L"paused",Json::JsonValue::CreateBooleanValue(!player||player->IsPaused()));state.SetNamedValue(L"ready",Json::JsonValue::CreateBooleanValue(ready));state.SetNamedValue(L"ended",Json::JsonValue::CreateBooleanValue(ended));state.SetNamedValue(L"closed",Json::JsonValue::CreateBooleanValue(closed));state.SetNamedValue(L"error",Json::JsonValue::CreateStringValue(error));state.SetNamedValue(L"request",Json::JsonValue::CreateStringValue(request));request.clear();state.SetNamedValue(L"audio",AudioTracks());Json::JsonArray subtitles;
    if(!cues.empty()){Json::JsonObject track;track.SetNamedValue(L"id",Json::JsonValue::CreateStringValue(L"external"));track.SetNamedValue(L"label",Json::JsonValue::CreateStringValue(L"Imported subtitles"));subtitles.Append(track);}state.SetNamedValue(L"subtitles",subtitles);
    std::wstring text;if(captions)for(auto const &cue:cues)if(position>=cue.start&&position<cue.end){text=cue.text;break;}if(caption){SetWindowTextW(caption,text.c_str());ShowWindow(caption,text.empty()?SW_HIDE:SW_SHOWNA);}return state;
  }
  void Subtitle(fs::path const &path) {
    auto content=winrt::to_hstring(CatalogStorage::Read(path));std::wistringstream stream{std::wstring(content)};std::wstring line;std::wregex timing(LR"((?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3}).*)");cues.clear();
    while(std::getline(stream,line)){std::wsmatch match;if(!std::regex_match(line,match,timing))continue;auto seconds=[&](int offset){return (match[offset].matched?std::stod(match[offset].str())*3600:0)+std::stod(match[offset+1].str())*60+std::stod(match[offset+2].str())+std::stod(match[offset+3].str())/1000;};Cue cue{seconds(1),seconds(5),L""};while(std::getline(stream,line)&&line!=L"\r"&&!line.empty()){if(!cue.text.empty())cue.text+=L"\n";cue.text+=line;}cues.push_back(std::move(cue));}captions=true;
  }
  REACT_METHOD(Execute, L"execute")
  void Execute(std::string method,std::string json,Promise promise) noexcept {
    context.UIDispatcher().Post([this,method,json,promise]() noexcept {
      try {
        auto args=Json::JsonObject::Parse(winrt::to_hstring(json));
        if(method=="place"){placeX=args.GetNamedNumber(L"x");placeY=args.GetNamedNumber(L"y");placeW=args.GetNamedNumber(L"width");placeH=args.GetNamedNumber(L"height");clipTop=args.GetNamedNumber(L"clipTop");clipBottom=args.GetNamedNumber(L"clipBottom");placeHidden=args.GetNamedBoolean(L"hidden");Apply();}
        else if(method=="nav"){navPrevious=args.GetNamedBoolean(L"previous");navNext=args.GetNamedBoolean(L"next");if(bar)InvalidateRect(bar,nullptr,FALSE);}
        else if(method=="open")Open(args);
        else if(method=="state"){}
        else if(method=="close"){Shut();if(mini)ToggleMini();if(full)ToggleFullscreen();if(window){DestroyWindow(window);window=nullptr;bar=nullptr;}ready=false;closed=true;}
        else {if(!player)throw std::runtime_error("Open a video first");if(method=="play")winrt::check_hresult(player->Play());else if(method=="pause")winrt::check_hresult(player->Pause());else if(method=="seek")Seek(std::min(Time(true),args.GetNamedNumber(L"position")));else if(method=="volume")winrt::check_hresult(player->SetVolume(std::clamp(args.GetNamedNumber(L"volume"),0.0,1.0)));else if(method=="rate")winrt::check_hresult(player->SetPlaybackRate(args.GetNamedNumber(L"rate")));else if(method=="show"){SetFocus(window);closed=false;}else if(method=="fullscreen")ToggleFullscreen();else if(method=="pip")ToggleMini();else if(method=="importSubtitle")Subtitle(CatalogStorage::Path(args.GetNamedString(L"uri")));else if(method=="subtitle")captions=args.GetNamedString(L"id")!=L"off";else if(method=="audio"){auto selected=std::stoul(std::wstring(args.GetNamedString(L"id")));auto tracks=AudioTracks();for(auto const &track:tracks.GetView()){auto index=std::stoul(std::wstring(track.GetObject().GetNamedString(L"id")));player->SetStreamSelection(index,index==selected);}winrt::check_hresult(player->ApplyStreamSelections());}else throw std::runtime_error("Unknown player command");}
        promise.Resolve(winrt::to_string(State().Stringify()));
      }catch(std::exception const &error){promise.Reject(error.what());}catch(winrt::hresult_error const &error){promise.Reject(error.message().c_str());}
    });
  }
};
