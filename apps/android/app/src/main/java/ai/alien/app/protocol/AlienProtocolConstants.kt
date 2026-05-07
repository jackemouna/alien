package ai.alien.app.protocol

enum class AlienCapability(
  val rawValue: String,
) {
  Canvas("canvas"),
  Camera("camera"),
  Sms("sms"),
  VoiceWake("voiceWake"),
  Talk("talk"),
  Location("location"),
  Device("device"),
  Notifications("notifications"),
  System("system"),
  Photos("photos"),
  Contacts("contacts"),
  Calendar("calendar"),
  Motion("motion"),
  CallLog("callLog"),
}

enum class AlienCanvasCommand(
  val rawValue: String,
) {
  Present("canvas.present"),
  Hide("canvas.hide"),
  Navigate("canvas.navigate"),
  Eval("canvas.eval"),
  Snapshot("canvas.snapshot"),
  ;

  companion object {
    const val NamespacePrefix: String = "canvas."
  }
}

enum class AlienCanvasA2UICommand(
  val rawValue: String,
) {
  Push("canvas.a2ui.push"),
  PushJSONL("canvas.a2ui.pushJSONL"),
  Reset("canvas.a2ui.reset"),
  ;

  companion object {
    const val NamespacePrefix: String = "canvas.a2ui."
  }
}

enum class AlienCameraCommand(
  val rawValue: String,
) {
  List("camera.list"),
  Snap("camera.snap"),
  Clip("camera.clip"),
  ;

  companion object {
    const val NamespacePrefix: String = "camera."
  }
}

enum class AlienSmsCommand(
  val rawValue: String,
) {
  Send("sms.send"),
  Search("sms.search"),
  ;

  companion object {
    const val NamespacePrefix: String = "sms."
  }
}

enum class AlienTalkCommand(
  val rawValue: String,
) {
  PttStart("talk.ptt.start"),
  PttStop("talk.ptt.stop"),
  PttCancel("talk.ptt.cancel"),
  PttOnce("talk.ptt.once"),
  ;

  companion object {
    const val NamespacePrefix: String = "talk."
  }
}

enum class AlienLocationCommand(
  val rawValue: String,
) {
  Get("location.get"),
  ;

  companion object {
    const val NamespacePrefix: String = "location."
  }
}

enum class AlienDeviceCommand(
  val rawValue: String,
) {
  Status("device.status"),
  Info("device.info"),
  Permissions("device.permissions"),
  Health("device.health"),
  ;

  companion object {
    const val NamespacePrefix: String = "device."
  }
}

enum class AlienNotificationsCommand(
  val rawValue: String,
) {
  List("notifications.list"),
  Actions("notifications.actions"),
  ;

  companion object {
    const val NamespacePrefix: String = "notifications."
  }
}

enum class AlienSystemCommand(
  val rawValue: String,
) {
  Notify("system.notify"),
  ;

  companion object {
    const val NamespacePrefix: String = "system."
  }
}

enum class AlienPhotosCommand(
  val rawValue: String,
) {
  Latest("photos.latest"),
  ;

  companion object {
    const val NamespacePrefix: String = "photos."
  }
}

enum class AlienContactsCommand(
  val rawValue: String,
) {
  Search("contacts.search"),
  Add("contacts.add"),
  ;

  companion object {
    const val NamespacePrefix: String = "contacts."
  }
}

enum class AlienCalendarCommand(
  val rawValue: String,
) {
  Events("calendar.events"),
  Add("calendar.add"),
  ;

  companion object {
    const val NamespacePrefix: String = "calendar."
  }
}

enum class AlienMotionCommand(
  val rawValue: String,
) {
  Activity("motion.activity"),
  Pedometer("motion.pedometer"),
  ;

  companion object {
    const val NamespacePrefix: String = "motion."
  }
}

enum class AlienCallLogCommand(
  val rawValue: String,
) {
  Search("callLog.search"),
  ;

  companion object {
    const val NamespacePrefix: String = "callLog."
  }
}
