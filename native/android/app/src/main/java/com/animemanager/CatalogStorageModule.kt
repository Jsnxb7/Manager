package com.animemanager

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** Private JSON IO and provider-aware user-selected media access. No media is copied for catalog transfer. */
class CatalogStorageModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private val privateRoot get() = File(context.filesDir, "catalogs").apply { mkdirs() }
  private var pending: Promise? = null
  private var pickerMode = ""
  private var saveBytes: ByteArray? = null
  private val preferences = context.getSharedPreferences("catalog-storage", 0)
  override fun getName() = "CatalogStorage"
  init {
    context.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != 4401) return
        val promise = pending ?: return
        pending = null
        val mode = pickerMode
        if (resultCode != Activity.RESULT_OK || data == null) { saveBytes = null; promise.resolve(if (mode == "pickFiles") "[]" else "null"); return }
        executor.execute {
          try {
            if (mode == "saveFile") {
              val uri = data.data ?: error("No destination selected")
              context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(saveBytes ?: error("No export bytes")) }
              saveBytes = null
              promise.resolve(JSONObject.quote(uri.toString()))
            } else {
              val uris = mutableListOf<Uri>()
              data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
              if (uris.isEmpty()) data.data?.let { uris.add(it) }
              for (uri in uris) {
                val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                try { context.contentResolver.takePersistableUriPermission(uri, flags) } catch (_: SecurityException) { /* Some providers grant session-only access. */ }
              }
              if (mode == "pickFolder") {
                val uri = uris.firstOrNull() ?: error("No folder selected")
                val roots = preferences.getStringSet("roots", emptySet())!!.toMutableSet()
                roots.add(uri.toString()); preferences.edit().putStringSet("roots", roots).apply()
                promise.resolve(JSONObject.quote(uri.toString()))
              } else promise.resolve(JSONArray(uris.map { it.toString() }).toString())
            }
          } catch (error: Exception) { saveBytes = null; promise.reject("STORAGE", error.message, error) }
        }
      }
    })
  }
  private fun owned(path: String): File {
    val file = File(path.removePrefix("file://")).canonicalFile
    val root = privateRoot.canonicalFile
    require(file.path.startsWith(root.path + File.separator)) { "Operation outside private app storage" }
    return file
  }
  private fun input(path: String) = if (path.startsWith("content://")) context.contentResolver.openInputStream(Uri.parse(path))!! else File(path.removePrefix("file://")).inputStream()
  private fun bytes(path: String): ByteArray = input(path).use { stream ->
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(65536)
    while (true) { val count = stream.read(buffer); if (count < 0) break; require(output.size() + count <= 128 * 1024 * 1024) { "File exceeds transfer limit" }; output.write(buffer, 0, count) }
    output.toByteArray()
  }
  private fun parts(relative: String): List<String> {
    val parts = relative.replace('\\', '/').split('/')
    require(parts.isNotEmpty() && parts.all { it.isNotEmpty() && it != "." && it != ".." && !it.contains(':') && it.none { c -> c.code < 32 } }) { "Invalid relative reference" }
    return parts
  }
  private fun document(root: Uri): Uri = DocumentsContract.buildDocumentUriUsingTree(root, DocumentsContract.getTreeDocumentId(root))
  private fun listing(uri: Uri): JSONArray {
    val result = JSONArray()
    val parent = if (DocumentsContract.isTreeUri(uri) && !uri.path.orEmpty().contains("/document/")) document(uri) else uri
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getDocumentId(parent))
    val query = context.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE), null, null, null) ?: error("Provider could not list folder")
    query.use { cursor ->
      while (cursor.moveToNext()) result.put(JSONObject().put("name", cursor.getString(1)).put("uri", DocumentsContract.buildDocumentUriUsingTree(uri, cursor.getString(0)).toString()).put("directory", cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR).put("size", cursor.getLong(3)))
    }
    return result
  }
  private fun resolve(root: String, relative: String): String? {
    val segments = parts(relative)
    if (!root.startsWith("content://")) {
      val parent = File(root.removePrefix("file://")).canonicalFile
      val child = File(parent, segments.joinToString(File.separator)).canonicalFile
      require(child.path.startsWith(parent.path + File.separator)) { "File escapes root" }
      return if (child.exists()) child.path else null
    }
    var current = root
    for (segment in segments) {
      val children = listing(Uri.parse(current))
      var next: String? = null
      for (index in 0 until children.length()) { val item = children.getJSONObject(index); if (item.getString("name") == segment) { next = item.getString("uri"); break } }
      current = next ?: return null
    }
    return current
  }
  private fun picker(method: String, payload: JSONObject, promise: Promise) {
    if (pending != null) { promise.reject("PICKER_BUSY", "Finish the open file picker first"); return }
    val activity = context.currentActivity ?: run { promise.reject("NO_ACTIVITY", "App window is not available"); return }
    val intent = when (method) {
      "pickFolder" -> Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
      "saveFile" -> Intent(Intent.ACTION_CREATE_DOCUMENT).setType(if (payload.getString("name").endsWith(".json")) "application/json" else "application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, payload.getString("name"))
      else -> Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(when(payload.optString("kind")) { "video" -> "video/*"; "image" -> "image/*"; else -> "*/*" }).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, payload.optString("kind") == "video").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    if (method == "saveFile") saveBytes = Base64.decode(payload.getString("value"), Base64.DEFAULT)
    pending = promise; pickerMode = method
    try { activity.startActivityForResult(intent, 4401) } catch (error: Exception) { pending = null; saveBytes = null; promise.reject("PICKER", error.message, error) }
  }
  @ReactMethod
  fun execute(method: String, json: String, promise: Promise) {
    val payload = try { JSONObject(json) } catch (error: Exception) { promise.reject("JSON", error.message); return }
    if (method in listOf("pickFolder", "pickFiles", "saveFile")) { UiThreadUtil.runOnUiThread { picker(method, payload, promise) }; return }
    executor.execute {
      try {
        val result: Any? = when (method) {
          "info" -> JSONObject().put("privateRoot", privateRoot.path)
          "readText" -> bytes(payload.getString("path")).toString(Charsets.UTF_8)
          "readBytes" -> Base64.encodeToString(bytes(payload.getString("uri")), Base64.NO_WRAP)
          "writeText" -> { val file=owned(payload.getString("path")); file.parentFile!!.mkdirs(); file.writeText(payload.getString("value")); null }
          "writeBytes" -> { val file=owned(payload.getString("uri")); file.parentFile!!.mkdirs(); file.writeBytes(Base64.decode(payload.getString("value"), Base64.DEFAULT)); null }
          "mkdir" -> { val path=payload.getString("uri"); if (File(path).canonicalFile != privateRoot.canonicalFile) owned(path).mkdirs() else privateRoot.mkdirs(); null }
          "exists" -> { val uri=payload.getString("uri"); if(uri.startsWith("content://")) context.contentResolver.query(Uri.parse(uri), arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)?.use { it.moveToFirst() } ?: false else File(uri.removePrefix("file://")).exists() }
          "list" -> { val uri=payload.getString("uri"); if(uri.startsWith("content://")) listing(Uri.parse(uri)) else JSONArray(File(uri.removePrefix("file://")).listFiles()?.map { JSONObject().put("name",it.name).put("uri",it.path).put("directory",it.isDirectory).put("size",it.length()) } ?: emptyList<JSONObject>()) }
          "replace" -> { val source=owned(payload.getString("staged")); val target=owned(payload.getString("destination")); require(source.parentFile == target.parentFile) { "Atomic replacement requires same directory" }; java.nio.file.Files.move(source.toPath(),target.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING,java.nio.file.StandardCopyOption.ATOMIC_MOVE); null }
          "removeOwned" -> { val file=owned(payload.getString("uri")); if(file.exists()) require(file.deleteRecursively()) { "Could not remove app-owned file" }; null }
          "resolveChild" -> resolve(payload.getString("root"),payload.getString("relativePath"))
          "createMediaFolder" -> {
            val root = payload.getString("root")
            require(preferences.getStringSet("roots", emptySet())!!.contains(root)) { "Select the local media root first" }
            require(root.startsWith("content://") && DocumentsContract.isTreeUri(Uri.parse(root))) { "Folder creation requires a selected document tree" }
            val segments = parts(payload.getString("relativePath"))
            var current = document(Uri.parse(root))
            for (segment in segments) {
              val children = listing(current)
              var next: Uri? = null
              for (index in 0 until children.length()) {
                val item = children.getJSONObject(index)
                if (item.getString("name") == segment) {
                  require(item.getBoolean("directory")) { "A file occupies the requested folder" }
                  require(next == null) { "Provider returned duplicate folder names" }
                  next = Uri.parse(item.getString("uri"))
                }
              }
              current = next ?: (DocumentsContract.createDocument(context.contentResolver, current, DocumentsContract.Document.MIME_TYPE_DIR, segment) ?: error("Provider could not create folder"))
            }
            current.toString()
          }
          "deleteMediaFolder" -> {
            val root=payload.getString("root"); require(preferences.getStringSet("roots",emptySet())!!.contains(root)) { "Select the local media root first" }
            val child=resolve(root,payload.getString("relativePath"))
            if(child != null) {
              require(child != root); require(child.startsWith("content://")) { "Media deletion requires a selected document tree" }
              val mime = context.contentResolver.query(Uri.parse(child), arrayOf(DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
              require(mime == DocumentsContract.Document.MIME_TYPE_DIR) { "Expected a media folder" }
              require(DocumentsContract.deleteDocument(context.contentResolver,Uri.parse(child))) { "Provider could not delete media folder" }
            }; null
          }
          "thumbnail" -> {
            val width=payload.getInt("width").coerceIn(64,1024)
            val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
            input(payload.getString("source")).use { BitmapFactory.decodeStream(it,null,bounds) }
            require(bounds.outWidth>0 && bounds.outHeight>0) { "Unsupported cover image" }
            var sample=1
            while(bounds.outWidth/sample>width*2 || bounds.outHeight/sample>2400) sample*=2
            val options=BitmapFactory.Options().apply { inSampleSize=sample }
            val image=input(payload.getString("source")).use { BitmapFactory.decodeStream(it,null,options) } ?: error("Unsupported cover image")
            val scale=minOf(1.0,width.toDouble()/image.width)
            val resized=Bitmap.createScaledBitmap(image,maxOf(1,(image.width*scale).toInt()),maxOf(1,(image.height*scale).toInt()),true)
            val destination=owned(payload.getString("destination"));destination.parentFile!!.mkdirs()
            destination.outputStream().use { require(resized.compress(if(Build.VERSION.SDK_INT>=30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP,82,it)) }
            if(resized !== image) resized.recycle();image.recycle();null
          }
          "reveal" -> throw UnsupportedOperationException("Use the Android file picker to locate media")
          else -> throw UnsupportedOperationException("Unknown storage operation: $method")
        }
        promise.resolve(when(result) { null -> "null"; is String -> JSONObject.quote(result); else -> result.toString() })
      } catch(error: Exception) { promise.reject("STORAGE",error.message,error) }
    }
  }
  override fun invalidate() { executor.shutdown(); super.invalidate() }
}
class CatalogStoragePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CatalogStorageModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
