#pragma once
#include "pch.h"
#include "NativeModules.h"
#include "CatalogStorage.h"
#include <mfplay.h>
#include <mfapi.h>
#include <mferror.h>
#include <atomic>
#include <cmath>
#include <mutex>
#include <regex>
#include <algorithm>

// A native video window avoids dependency on a Paper-only React view in a Fabric host.
REACT_MODULE(CatalogPlayer)
struct CatalogPlayer {
  using Promise = winrt::Microsoft::ReactNative::ReactPromise<std::string>;
  winrt::Microsoft::ReactNative::ReactContext context;
  winrt::com_ptr<IMFPMediaPlayer> player;
  HWND window = nullptr, video = nullptr, caption = nullptr;
  std::atomic<bool> ready{false}, ended{false};
  bool closed = true, full = false, captions = true;
  double resume = 0;
  RECT normalRect{}; LONG normalStyle = 0;
  std::wstring error;
  struct Cue { double start, end; std::wstring text; };
  std::vector<Cue> cues;
  std::mutex mutex;
  struct Callback : IMFPMediaPlayerCallback {
    std::atomic<ULONG> references{1}; CatalogPlayer *owner;
    explicit Callback(CatalogPlayer *value) : owner(value) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void **result) override { if (!result) return E_POINTER; if (iid == __uuidof(IUnknown) || iid == __uuidof(IMFPMediaPlayerCallback)) { *result = static_cast<IMFPMediaPlayerCallback *>(this); AddRef(); return S_OK; } *result = nullptr; return E_NOINTERFACE; }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
    ULONG STDMETHODCALLTYPE Release() override { auto count = --references; if (!count) delete this; return count; }
    void STDMETHODCALLTYPE OnMediaPlayerEvent(MFP_EVENT_HEADER *event) override {
      std::lock_guard<std::mutex> lock(owner->mutex);
      if (FAILED(event->hrEvent)) { owner->error = L"Cannot decode this video. Check the file and installed codecs."; return; }
      if (event->eEventType == MFP_EVENT_TYPE_MEDIAITEM_CREATED) {
        auto created = MFP_GET_MEDIAITEM_CREATED_EVENT(event); event->pMediaPlayer->SetMediaItem(created->pMediaItem);
      } else if (event->eEventType == MFP_EVENT_TYPE_MEDIAITEM_SET) {
        owner->ready = true; try { owner->Seek(std::min(owner->resume,std::max(0.0,owner->Time(true)-1))); event->pMediaPlayer->Play(); } catch (...) { owner->error=L"Could not start playback at the saved position"; }
      } else if (event->eEventType == MFP_EVENT_TYPE_PLAYBACK_ENDED) owner->ended = true;
    }
  };
  winrt::com_ptr<Callback> callback;
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept { context = value; }
  void Seek(double seconds) {
    if (!player || !std::isfinite(seconds)) return;
    PROPVARIANT position; PropVariantInit(&position); position.vt = VT_I8; position.hVal.QuadPart = static_cast<LONGLONG>(std::max(0.0, seconds) * 10000000);
    winrt::check_hresult(player->SetPosition(MFP_POSITIONTYPE_100NS, &position)); ended = false;
  }
  double Time(bool duration = false) {
    if (!player) return 0;
    PROPVARIANT value; PropVariantInit(&value);
    auto status = duration ? player->GetDuration(MFP_POSITIONTYPE_100NS, &value) : player->GetPosition(MFP_POSITIONTYPE_100NS, &value);
    double result = SUCCEEDED(status) && value.vt == VT_I8 ? value.hVal.QuadPart / 10000000.0 : 0;
    PropVariantClear(&value); return std::max(0.0, result);
  }
  void ToggleFullscreen() {
    if (!window) return;
    if (!full) { GetWindowRect(window, &normalRect); normalStyle = GetWindowLongW(window, GWL_STYLE); SetWindowLongW(window, GWL_STYLE, WS_POPUP | WS_VISIBLE); MONITORINFO info{sizeof(info)}; GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &info); SetWindowPos(window, HWND_TOP, info.rcMonitor.left, info.rcMonitor.top, info.rcMonitor.right-info.rcMonitor.left, info.rcMonitor.bottom-info.rcMonitor.top, SWP_FRAMECHANGED); }
    else { SetWindowLongW(window,GWL_STYLE,normalStyle);SetWindowPos(window,nullptr,normalRect.left,normalRect.top,normalRect.right-normalRect.left,normalRect.bottom-normalRect.top,SWP_FRAMECHANGED|SWP_NOZORDER); }
    full = !full;
  }
  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
    auto self = reinterpret_cast<CatalogPlayer *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) { self = static_cast<CatalogPlayer *>(reinterpret_cast<CREATESTRUCTW *>(lp)->lpCreateParams); SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(self)); }
    if (!self) return DefWindowProcW(hwnd,message,wp,lp);
    try {
      if (message == WM_SIZE) { auto w=LOWORD(lp),h=HIWORD(lp);MoveWindow(self->video,0,0,w,std::max(1,static_cast<int>(h)-100),TRUE);MoveWindow(self->caption,8,std::max(0,static_cast<int>(h)-96),std::max(1,static_cast<int>(w)-16),46,TRUE);for(int i=0;i<4;i++)MoveWindow(GetDlgItem(hwnd,i+1),12+i*150,std::max(0,static_cast<int>(h)-44),140,36,TRUE);if(self->player)self->player->UpdateVideo();return 0; }
      if(message==WM_CTLCOLORSTATIC){auto dc=reinterpret_cast<HDC>(wp);SetTextColor(dc,RGB(241,243,245));SetBkColor(dc,RGB(36,38,41));static HBRUSH brush=CreateSolidBrush(RGB(36,38,41));return reinterpret_cast<LRESULT>(brush);}
      if (message == WM_CLOSE) { if(self->player)self->player->Pause();ShowWindow(hwnd,SW_HIDE);self->closed=true;return 0; }
      if (message == WM_COMMAND) { if(LOWORD(wp)==1){MFP_MEDIAPLAYER_STATE state;self->player->GetState(&state);if(state==MFP_MEDIAPLAYER_STATE_PLAYING)self->player->Pause();else self->player->Play();}else if(LOWORD(wp)==2)self->Seek(std::max(0.0,self->Time()-10));else if(LOWORD(wp)==3)self->Seek(std::min(self->Time(true),self->Time()+10));else if(LOWORD(wp)==4)self->ToggleFullscreen();return 0; }
      if (message == WM_KEYDOWN && self->player) { if(wp==VK_SPACE){if(!(lp & (1LL<<30)))SendMessageW(hwnd,WM_COMMAND,1,0);return 0;}if(wp==VK_LEFT)self->Seek(std::max(0.0,self->Time()-10));else if(wp==VK_RIGHT)self->Seek(std::min(self->Time(true),self->Time()+10));else if(wp=='F'&&!(lp&(1LL<<30)))self->ToggleFullscreen();else if(wp=='M'&&!(lp&(1LL<<30))){BOOL muted;self->player->GetMute(&muted);self->player->SetMute(!muted);}else if(wp==VK_UP||wp==VK_DOWN){float volume;self->player->GetVolume(&volume);self->player->SetVolume(std::clamp(volume+(wp==VK_UP?0.1f:-0.1f),0.0f,1.0f));}else return DefWindowProcW(hwnd,message,wp,lp);return 0; }
    } catch (...) { self->error=L"Player command failed"; }
    return DefWindowProcW(hwnd,message,wp,lp);
  }
  void Open(Json::JsonObject const &args) {
    if(player){player->Shutdown();player=nullptr;}
    std::lock_guard<std::mutex> lock(mutex);
    if(window){DestroyWindow(window);window=nullptr;}
    WNDCLASSW wc{};wc.lpfnWndProc=WindowProc;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"AnimeManagerVideo";wc.hbrBackground=static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));RegisterClassW(&wc);
    window=CreateWindowExW(0,wc.lpszClassName,args.GetNamedString(L"title",L"Anime Manager").c_str(),WS_OVERLAPPEDWINDOW|WS_VISIBLE,100,100,1000,700,nullptr,nullptr,wc.hInstance,this);
    if(!window)throw std::runtime_error("Could not create native video window");
    video=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE,0,0,980,550,window,nullptr,wc.hInstance,nullptr);
    caption=CreateWindowW(L"STATIC",L"",WS_CHILD|WS_VISIBLE|SS_CENTER,8,554,960,44,window,nullptr,wc.hInstance,nullptr);
    const wchar_t *labels[]={L"Play / Pause",L"Back 10s",L"Forward 10s",L"Fullscreen"};for(int i=0;i<4;i++)CreateWindowW(L"BUTTON",labels[i],WS_CHILD|WS_VISIBLE|WS_TABSTOP,12+i*150,604,140,36,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(i+1)),wc.hInstance,nullptr);
    ready=false;ended=false;closed=false;full=false;error.clear();cues.clear();resume=args.GetNamedNumber(L"position",0);
    callback.attach(new Callback(this));
    winrt::check_hresult(MFPCreateMediaPlayer(nullptr,FALSE,0,callback.get(),video,player.put()));
    auto uri=args.GetNamedString(L"uri");winrt::check_hresult(player->CreateMediaItemFromURL(uri.c_str(),FALSE,0,nullptr));
  }
  Json::JsonArray AudioTracks() {
    Json::JsonArray tracks; if(!player||!ready)return tracks;
    winrt::com_ptr<IMFPMediaItem> item;if(FAILED(player->GetMediaItem(item.put())))return tracks;
    DWORD count=0;item->GetNumberOfStreams(&count);
    for(DWORD i=0;i<count;i++){PROPVARIANT type;PropVariantInit(&type);if(SUCCEEDED(item->GetStreamAttribute(i,MF_MT_MAJOR_TYPE,&type))&&type.vt==VT_CLSID&&*type.puuid==MFMediaType_Audio){Json::JsonObject row;row.SetNamedValue(L"id",Json::JsonValue::CreateStringValue(std::to_wstring(i)));row.SetNamedValue(L"label",Json::JsonValue::CreateStringValue(L"Audio "+std::to_wstring(tracks.Size()+1)));tracks.Append(row);}PropVariantClear(&type);}return tracks;
  }
  Json::JsonObject State() {
    std::lock_guard<std::mutex> lock(mutex);Json::JsonObject state;MFP_MEDIAPLAYER_STATE status=MFP_MEDIAPLAYER_STATE_EMPTY;if(player)player->GetState(&status);auto position=Time();
    state.SetNamedValue(L"position",Json::JsonValue::CreateNumberValue(position));state.SetNamedValue(L"duration",Json::JsonValue::CreateNumberValue(Time(true)));state.SetNamedValue(L"paused",Json::JsonValue::CreateBooleanValue(status!=MFP_MEDIAPLAYER_STATE_PLAYING));state.SetNamedValue(L"ready",Json::JsonValue::CreateBooleanValue(ready));state.SetNamedValue(L"ended",Json::JsonValue::CreateBooleanValue(ended));state.SetNamedValue(L"closed",Json::JsonValue::CreateBooleanValue(closed));state.SetNamedValue(L"error",Json::JsonValue::CreateStringValue(error));state.SetNamedValue(L"audio",AudioTracks());Json::JsonArray subtitles;
    if(!cues.empty()){Json::JsonObject track;track.SetNamedValue(L"id",Json::JsonValue::CreateStringValue(L"external"));track.SetNamedValue(L"label",Json::JsonValue::CreateStringValue(L"Imported subtitles"));subtitles.Append(track);}state.SetNamedValue(L"subtitles",subtitles);
    std::wstring text;if(captions)for(auto const &cue:cues)if(position>=cue.start&&position<cue.end){text=cue.text;break;}if(caption)SetWindowTextW(caption,text.c_str());return state;
  }
  void Subtitle(fs::path const &path) {
    auto content=winrt::to_hstring(CatalogStorage::Read(path));std::wistringstream stream{std::wstring(content)};std::wstring line;std::wregex timing(LR"((?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3}).*)");cues.clear();
    while(std::getline(stream,line)){std::wsmatch match;if(!std::regex_match(line,match,timing))continue;auto seconds=[&](int offset){return (match[offset].matched?std::stod(match[offset].str())*3600:0)+std::stod(match[offset+1].str())*60+std::stod(match[offset+2].str())+std::stod(match[offset+3].str())/1000;};Cue cue{seconds(1),seconds(5),L""};while(std::getline(stream,line)&&line!=L"\r"&&!line.empty()){if(!cue.text.empty())cue.text+=L"\n";cue.text+=line;}cues.push_back(std::move(cue));}captions=true;
  }
  REACT_METHOD(execute)
  void Execute(std::string method,std::string json,Promise promise) noexcept {
    context.UIDispatcher().Post([this,method,json,promise]() noexcept {
      try {
        auto args=Json::JsonObject::Parse(winrt::to_hstring(json));
        if(method=="open")Open(args);
        else if(method=="state"){}
        else if(method=="close"){if(player){player->Shutdown();player=nullptr;}if(window){DestroyWindow(window);window=nullptr;}ready=false;closed=true;}
        else {if(!player)throw std::runtime_error("Open a video first");if(method=="play")winrt::check_hresult(player->Play());else if(method=="pause")winrt::check_hresult(player->Pause());else if(method=="seek")Seek(std::min(Time(true),args.GetNamedNumber(L"position")));else if(method=="volume")winrt::check_hresult(player->SetVolume(static_cast<float>(std::clamp(args.GetNamedNumber(L"volume"),0.0,1.0))));else if(method=="rate")winrt::check_hresult(player->SetRate(static_cast<float>(args.GetNamedNumber(L"rate"))));else if(method=="show"){ShowWindow(window,SW_SHOW);SetForegroundWindow(window);closed=false;}else if(method=="fullscreen")ToggleFullscreen();else if(method=="importSubtitle")Subtitle(CatalogStorage::Path(args.GetNamedString(L"uri")));else if(method=="subtitle")captions=args.GetNamedString(L"id")!=L"off";else if(method=="audio"){auto selected=std::stoul(std::wstring(args.GetNamedString(L"id")));winrt::com_ptr<IMFPMediaItem> item;winrt::check_hresult(player->GetMediaItem(item.put()));resume=Time();auto tracks=AudioTracks();for(auto const &track:tracks.GetView()){auto index=std::stoul(std::wstring(track.GetObject().GetNamedString(L"id")));item->SetStreamSelection(index,index==selected);}winrt::check_hresult(player->SetMediaItem(item.get()));}else throw std::runtime_error("Unknown player command");}
        promise.Resolve(winrt::to_string(State().Stringify()));
      }catch(std::exception const &error){promise.Reject(error.what());}catch(winrt::hresult_error const &error){promise.Reject(winrt::to_string(error.message()));}
    });
  }
};
