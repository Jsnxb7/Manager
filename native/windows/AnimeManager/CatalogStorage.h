#pragma once
#include "pch.h"
#include "NativeModules.h"
#include <filesystem>
#include <algorithm>
#include <cwctype>
#include <vector>
#include <stdexcept>
#include <fstream>
#include <set>
#include <sstream>
#include <shlobj.h>
#include <shobjidl.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>

namespace fs = std::filesystem;
namespace Json = winrt::Windows::Data::Json;
namespace Crypto = winrt::Windows::Security::Cryptography;

REACT_MODULE(CatalogStorage)
struct CatalogStorage {
  winrt::Microsoft::ReactNative::ReactContext context;
  fs::path root;
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &value) noexcept {
    context = value;
    PWSTR local = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) {
      root = fs::path(local) / L"AnimeManager" / L"catalogs";
      CoTaskMemFree(local);
      std::error_code error; fs::create_directories(root, error);
    }
  }
  static std::string Read(fs::path const &path) {
    if (fs::file_size(path) > 128 * 1024 * 1024) throw std::runtime_error("File exceeds transfer limit");
    std::ifstream stream(path, std::ios::binary);
    if (!stream) throw std::runtime_error("Cannot read file");
    return {std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>()};
  }
  static void Write(fs::path const &path, std::string const &text) {
    fs::create_directories(path.parent_path());
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    stream.write(text.data(), static_cast<std::streamsize>(text.size())); stream.flush();
    if (!stream) throw std::runtime_error("Cannot save file; check free space and permissions");
  }
  static fs::path Path(winrt::hstring const &value) {
    std::wstring text(value); if (text.rfind(L"file://", 0) == 0) text = text.substr(7);
    return fs::path(text);
  }
  static bool Within(fs::path const &parent, fs::path const &child) {
    auto p = fs::weakly_canonical(parent); auto c = fs::weakly_canonical(child);
    auto pi = p.begin(), ci = c.begin();
    for (; pi != p.end(); ++pi, ++ci) {
      if (ci == c.end() || _wcsicmp(pi->c_str(), ci->c_str()) != 0) return false;
    }
    return ci != c.end();
  }
  fs::path Owned(winrt::hstring const &value) {
    auto path = Path(value);
    if (root.empty() || !Within(root, path)) throw std::runtime_error("Operation outside app private storage");
    return path;
  }
  static fs::path Child(fs::path const &parent, winrt::hstring const &relative) {
    std::wstring text(relative); std::replace(text.begin(), text.end(), L'\\', L'/');
    fs::path rel(text);
    if (rel.empty() || rel.is_absolute() || rel.has_root_name()) throw std::runtime_error("Invalid relative media reference");
    for (auto const &part : rel) if (part == L".." || part == L"." || part.wstring().find(L':') != std::wstring::npos) throw std::runtime_error("Invalid relative media reference");
    auto target = parent / rel;
    if (!Within(parent, target)) throw std::runtime_error("Media reference escapes selected root");
    return target;
  }
  static Json::IJsonValue String(std::wstring const &text) { return Json::JsonValue::CreateStringValue(text); }
  static Json::IJsonValue Null() { return Json::JsonValue::CreateNullValue(); }
  std::set<std::wstring> Roots() {
    std::set<std::wstring> result;
    auto file = root / L"approved-roots.json";
    if (fs::exists(file)) {
      auto values = Json::JsonArray::Parse(winrt::to_hstring(Read(file)));
      for (auto const &value : values) result.insert(std::wstring(value.GetString()));
    }
    return result;
  }
  void Approve(std::wstring const &path) {
    auto values = Roots(); values.insert(path); Json::JsonArray array;
    for (auto const &value : values) array.Append(String(value));
    Write(root / L"approved-roots.json", winrt::to_string(array.Stringify()));
  }
  Json::IJsonValue Pick(std::string const &method, Json::JsonObject const &args) {
    if (method == "saveFile") {
      winrt::com_ptr<IFileSaveDialog> dialog;
      winrt::check_hresult(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
      dialog->SetFileName(args.GetNamedString(L"name").c_str());
      if (dialog->Show(nullptr) != S_OK) return Null();
      winrt::com_ptr<IShellItem> item; winrt::check_hresult(dialog->GetResult(item.put()));
      PWSTR selected = nullptr; winrt::check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &selected));
      std::wstring filename(selected); CoTaskMemFree(selected);
      auto buffer = Crypto::CryptographicBuffer::DecodeFromBase64String(args.GetNamedString(L"value"));
      winrt::com_array<uint8_t> bytes; Crypto::CryptographicBuffer::CopyToByteArray(buffer, bytes);
      Write(filename, std::string(reinterpret_cast<char const *>(bytes.data()), bytes.size()));
      return String(filename);
    }
    winrt::com_ptr<IFileOpenDialog> dialog;
    winrt::check_hresult(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
    DWORD options = 0; dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_FORCEFILESYSTEM | (method == "pickFolder" ? FOS_PICKFOLDERS : FOS_ALLOWMULTISELECT));
    if (dialog->Show(nullptr) != S_OK) return method == "pickFolder" ? Null() : Json::JsonArray();
    winrt::com_ptr<IShellItemArray> items; winrt::check_hresult(dialog->GetResults(items.put()));
    DWORD count = 0; items->GetCount(&count); Json::JsonArray paths;
    for (DWORD i = 0; i < count; ++i) {
      winrt::com_ptr<IShellItem> item; items->GetItemAt(i, item.put());
      PWSTR selected = nullptr; winrt::check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &selected));
      std::wstring filename(selected); CoTaskMemFree(selected);
      if (method == "pickFolder") { Approve(filename); return String(filename); }
      paths.Append(String(filename));
    }
    return paths;
  }
  Json::IJsonValue Operation(std::string const &method, Json::JsonObject const &args) {
    if (method == "info") { Json::JsonObject info; info.SetNamedValue(L"privateRoot", String(root.wstring()));
      int count=0;auto argv=CommandLineToArgvW(GetCommandLineW(),&count);
      if(argv&&count>1&&fs::is_regular_file(argv[1])){auto extension=fs::path(argv[1]).extension().wstring();std::transform(extension.begin(),extension.end(),extension.begin(),::towlower);if(extension==L".mp4"||extension==L".mkv"||extension==L".webm"||extension==L".avi"||extension==L".mov"||extension==L".m4v")info.SetNamedValue(L"initialMedia",String(argv[1]));}
      if(argv)LocalFree(argv);return info; }
    if (method == "readText") return String(winrt::to_hstring(Read(Path(args.GetNamedString(L"path")))) .c_str());
    if (method == "readBytes") {
      auto bytes = Read(Path(args.GetNamedString(L"uri")));
      auto buffer = Crypto::CryptographicBuffer::CreateFromByteArray(winrt::array_view<uint8_t const>(reinterpret_cast<uint8_t const *>(bytes.data()), reinterpret_cast<uint8_t const *>(bytes.data()) + bytes.size()));
      return Json::JsonValue::CreateStringValue(Crypto::CryptographicBuffer::EncodeToBase64String(buffer));
    }
    if (method == "writeText") { Write(Owned(args.GetNamedString(L"path")), winrt::to_string(args.GetNamedString(L"value"))); return Null(); }
    if (method == "writeBytes") {
      auto buffer = Crypto::CryptographicBuffer::DecodeFromBase64String(args.GetNamedString(L"value")); winrt::com_array<uint8_t> bytes;
      Crypto::CryptographicBuffer::CopyToByteArray(buffer, bytes);
      Write(Owned(args.GetNamedString(L"uri")), std::string(reinterpret_cast<char const *>(bytes.data()), bytes.size())); return Null();
    }
    if (method == "exists") return Json::JsonValue::CreateBooleanValue(fs::exists(Path(args.GetNamedString(L"uri"))));
    if (method == "mkdir") { auto path = Path(args.GetNamedString(L"uri")); if (fs::weakly_canonical(path) != fs::weakly_canonical(root)) path = Owned(args.GetNamedString(L"uri")); fs::create_directories(path); return Null(); }
    if (method == "replace") {
      auto source = Owned(args.GetNamedString(L"staged")), destination = Owned(args.GetNamedString(L"destination"));
      if (source.parent_path() != destination.parent_path()) throw std::runtime_error("Atomic replacement requires same directory");
      if (!MoveFileExW(source.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Cannot replace JSON snapshot"); return Null();
    }
    if (method == "removeOwned") { fs::remove_all(Owned(args.GetNamedString(L"uri"))); return Null(); }
    if (method == "list") {
      Json::JsonArray result;
      for (auto const &file : fs::directory_iterator(Path(args.GetNamedString(L"uri")))) {
        Json::JsonObject value; value.SetNamedValue(L"name", String(file.path().filename().wstring())); value.SetNamedValue(L"uri", String(file.path().wstring()));
        value.SetNamedValue(L"directory", Json::JsonValue::CreateBooleanValue(file.is_directory())); value.SetNamedValue(L"size", Json::JsonValue::CreateNumberValue(file.is_regular_file() ? static_cast<double>(file.file_size()) : 0)); result.Append(value);
      } return result;
    }
    if (method == "resolveChild") { auto path = Child(Path(args.GetNamedString(L"root")), args.GetNamedString(L"relativePath")); return fs::exists(path) ? String(path.wstring()) : Null(); }
    if (method == "deleteMediaFolder") {
      auto parent = Path(args.GetNamedString(L"root"));
      if (!Roots().count(parent.wstring())) throw std::runtime_error("Select the local media root first");
      auto target = Child(parent, args.GetNamedString(L"relativePath"));
      if (!fs::exists(target)) return Null();
      if (!fs::is_directory(target)) throw std::runtime_error("Expected a season folder");
      auto walk = parent;
      for (auto const &part : fs::relative(target, parent)) { walk /= part; if (GetFileAttributesW(walk.c_str()) & FILE_ATTRIBUTE_REPARSE_POINT) throw std::runtime_error("Relink junction/symlink media before deleting"); }
      for (auto const &entry : fs::recursive_directory_iterator(target)) if (GetFileAttributesW(entry.path().c_str()) & FILE_ATTRIBUTE_REPARSE_POINT) throw std::runtime_error("Media folder contains a junction/symlink");
      fs::remove_all(target); return Null();
    }
    if (method == "reveal") { auto path = Path(args.GetNamedString(L"uri")); ShellExecuteW(nullptr, L"open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL); return Null(); }
    if (method == "thumbnail") throw std::runtime_error("WebP encoder unavailable in this host; original cover format will be preserved");
    throw std::runtime_error("Unknown storage operation");
  }
  REACT_METHOD(execute)
  void Execute(std::string method, std::string json, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    if (method == "pickFolder" || method == "pickFiles" || method == "saveFile") {
      context.UIDispatcher().Post([this, method, json, promise]() noexcept {
        try { promise.Resolve(winrt::to_string(Pick(method, Json::JsonObject::Parse(winrt::to_hstring(json))).Stringify())); }
        catch (std::exception const &error) { promise.Reject(error.what()); }
        catch (winrt::hresult_error const &error) { promise.Reject(winrt::to_string(error.message())); }
      });
    } else { Dispatch(method, json, promise); }
  }
  winrt::fire_and_forget Dispatch(std::string method, std::string json, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    co_await winrt::resume_background();
    try { promise.Resolve(winrt::to_string(Operation(method, Json::JsonObject::Parse(winrt::to_hstring(json))).Stringify())); }
    catch (std::exception const &error) { promise.Reject(error.what()); }
    catch (winrt::hresult_error const &error) { promise.Reject(winrt::to_string(error.message())); }
  }
};
