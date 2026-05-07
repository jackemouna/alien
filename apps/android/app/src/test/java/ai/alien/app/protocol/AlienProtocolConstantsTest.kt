package ai.alien.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class AlienProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", AlienCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", AlienCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", AlienCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", AlienCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", AlienCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", AlienCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", AlienCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", AlienCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", AlienCapability.Canvas.rawValue)
    assertEquals("camera", AlienCapability.Camera.rawValue)
    assertEquals("voiceWake", AlienCapability.VoiceWake.rawValue)
    assertEquals("talk", AlienCapability.Talk.rawValue)
    assertEquals("location", AlienCapability.Location.rawValue)
    assertEquals("sms", AlienCapability.Sms.rawValue)
    assertEquals("device", AlienCapability.Device.rawValue)
    assertEquals("notifications", AlienCapability.Notifications.rawValue)
    assertEquals("system", AlienCapability.System.rawValue)
    assertEquals("photos", AlienCapability.Photos.rawValue)
    assertEquals("contacts", AlienCapability.Contacts.rawValue)
    assertEquals("calendar", AlienCapability.Calendar.rawValue)
    assertEquals("motion", AlienCapability.Motion.rawValue)
    assertEquals("callLog", AlienCapability.CallLog.rawValue)
  }

  @Test
  fun cameraCommandsUseStableStrings() {
    assertEquals("camera.list", AlienCameraCommand.List.rawValue)
    assertEquals("camera.snap", AlienCameraCommand.Snap.rawValue)
    assertEquals("camera.clip", AlienCameraCommand.Clip.rawValue)
  }

  @Test
  fun notificationsCommandsUseStableStrings() {
    assertEquals("notifications.list", AlienNotificationsCommand.List.rawValue)
    assertEquals("notifications.actions", AlienNotificationsCommand.Actions.rawValue)
  }

  @Test
  fun deviceCommandsUseStableStrings() {
    assertEquals("device.status", AlienDeviceCommand.Status.rawValue)
    assertEquals("device.info", AlienDeviceCommand.Info.rawValue)
    assertEquals("device.permissions", AlienDeviceCommand.Permissions.rawValue)
    assertEquals("device.health", AlienDeviceCommand.Health.rawValue)
  }

  @Test
  fun systemCommandsUseStableStrings() {
    assertEquals("system.notify", AlienSystemCommand.Notify.rawValue)
  }

  @Test
  fun photosCommandsUseStableStrings() {
    assertEquals("photos.latest", AlienPhotosCommand.Latest.rawValue)
  }

  @Test
  fun contactsCommandsUseStableStrings() {
    assertEquals("contacts.search", AlienContactsCommand.Search.rawValue)
    assertEquals("contacts.add", AlienContactsCommand.Add.rawValue)
  }

  @Test
  fun calendarCommandsUseStableStrings() {
    assertEquals("calendar.events", AlienCalendarCommand.Events.rawValue)
    assertEquals("calendar.add", AlienCalendarCommand.Add.rawValue)
  }

  @Test
  fun motionCommandsUseStableStrings() {
    assertEquals("motion.activity", AlienMotionCommand.Activity.rawValue)
    assertEquals("motion.pedometer", AlienMotionCommand.Pedometer.rawValue)
  }

  @Test
  fun smsCommandsUseStableStrings() {
    assertEquals("sms.send", AlienSmsCommand.Send.rawValue)
    assertEquals("sms.search", AlienSmsCommand.Search.rawValue)
  }

  @Test
  fun talkCommandsUseStableStrings() {
    assertEquals("talk.ptt.start", AlienTalkCommand.PttStart.rawValue)
    assertEquals("talk.ptt.stop", AlienTalkCommand.PttStop.rawValue)
    assertEquals("talk.ptt.cancel", AlienTalkCommand.PttCancel.rawValue)
    assertEquals("talk.ptt.once", AlienTalkCommand.PttOnce.rawValue)
  }

  @Test
  fun callLogCommandsUseStableStrings() {
    assertEquals("callLog.search", AlienCallLogCommand.Search.rawValue)
  }
}
