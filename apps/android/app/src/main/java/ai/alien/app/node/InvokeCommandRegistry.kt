package ai.alien.app.node

import ai.alien.app.protocol.AlienCalendarCommand
import ai.alien.app.protocol.AlienCallLogCommand
import ai.alien.app.protocol.AlienCameraCommand
import ai.alien.app.protocol.AlienCanvasA2UICommand
import ai.alien.app.protocol.AlienCanvasCommand
import ai.alien.app.protocol.AlienCapability
import ai.alien.app.protocol.AlienContactsCommand
import ai.alien.app.protocol.AlienDeviceCommand
import ai.alien.app.protocol.AlienLocationCommand
import ai.alien.app.protocol.AlienMotionCommand
import ai.alien.app.protocol.AlienNotificationsCommand
import ai.alien.app.protocol.AlienPhotosCommand
import ai.alien.app.protocol.AlienSmsCommand
import ai.alien.app.protocol.AlienSystemCommand
import ai.alien.app.protocol.AlienTalkCommand

data class NodeRuntimeFlags(
  val cameraEnabled: Boolean,
  val locationEnabled: Boolean,
  val sendSmsAvailable: Boolean,
  val readSmsAvailable: Boolean,
  val smsSearchPossible: Boolean,
  val callLogAvailable: Boolean,
  val voiceWakeEnabled: Boolean,
  val motionActivityAvailable: Boolean,
  val motionPedometerAvailable: Boolean,
  val debugBuild: Boolean,
)

enum class InvokeCommandAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SendSmsAvailable,
  ReadSmsAvailable,
  RequestableSmsSearchAvailable,
  CallLogAvailable,
  MotionActivityAvailable,
  MotionPedometerAvailable,
  DebugBuild,
}

enum class NodeCapabilityAvailability {
  Always,
  CameraEnabled,
  LocationEnabled,
  SmsAvailable,
  CallLogAvailable,
  VoiceWakeEnabled,
  MotionAvailable,
}

data class NodeCapabilitySpec(
  val name: String,
  val availability: NodeCapabilityAvailability = NodeCapabilityAvailability.Always,
)

data class InvokeCommandSpec(
  val name: String,
  val requiresForeground: Boolean = false,
  val availability: InvokeCommandAvailability = InvokeCommandAvailability.Always,
)

object InvokeCommandRegistry {
  val capabilityManifest: List<NodeCapabilitySpec> =
    listOf(
      NodeCapabilitySpec(name = AlienCapability.Canvas.rawValue),
      NodeCapabilitySpec(name = AlienCapability.Device.rawValue),
      NodeCapabilitySpec(name = AlienCapability.Notifications.rawValue),
      NodeCapabilitySpec(name = AlienCapability.System.rawValue),
      NodeCapabilitySpec(
        name = AlienCapability.Camera.rawValue,
        availability = NodeCapabilityAvailability.CameraEnabled,
      ),
      NodeCapabilitySpec(
        name = AlienCapability.Sms.rawValue,
        availability = NodeCapabilityAvailability.SmsAvailable,
      ),
      NodeCapabilitySpec(
        name = AlienCapability.VoiceWake.rawValue,
        availability = NodeCapabilityAvailability.VoiceWakeEnabled,
      ),
      NodeCapabilitySpec(name = AlienCapability.Talk.rawValue),
      NodeCapabilitySpec(
        name = AlienCapability.Location.rawValue,
        availability = NodeCapabilityAvailability.LocationEnabled,
      ),
      NodeCapabilitySpec(name = AlienCapability.Photos.rawValue),
      NodeCapabilitySpec(name = AlienCapability.Contacts.rawValue),
      NodeCapabilitySpec(name = AlienCapability.Calendar.rawValue),
      NodeCapabilitySpec(
        name = AlienCapability.Motion.rawValue,
        availability = NodeCapabilityAvailability.MotionAvailable,
      ),
      NodeCapabilitySpec(
        name = AlienCapability.CallLog.rawValue,
        availability = NodeCapabilityAvailability.CallLogAvailable,
      ),
    )

  val all: List<InvokeCommandSpec> =
    listOf(
      InvokeCommandSpec(
        name = AlienCanvasCommand.Present.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasCommand.Hide.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasCommand.Navigate.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasCommand.Eval.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasCommand.Snapshot.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasA2UICommand.Push.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasA2UICommand.PushJSONL.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienCanvasA2UICommand.Reset.rawValue,
        requiresForeground = true,
      ),
      InvokeCommandSpec(
        name = AlienSystemCommand.Notify.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienTalkCommand.PttStart.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienTalkCommand.PttStop.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienTalkCommand.PttCancel.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienTalkCommand.PttOnce.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienCameraCommand.List.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = AlienCameraCommand.Snap.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = AlienCameraCommand.Clip.rawValue,
        requiresForeground = true,
        availability = InvokeCommandAvailability.CameraEnabled,
      ),
      InvokeCommandSpec(
        name = AlienLocationCommand.Get.rawValue,
        availability = InvokeCommandAvailability.LocationEnabled,
      ),
      InvokeCommandSpec(
        name = AlienDeviceCommand.Status.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienDeviceCommand.Info.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienDeviceCommand.Permissions.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienDeviceCommand.Health.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienNotificationsCommand.List.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienNotificationsCommand.Actions.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienPhotosCommand.Latest.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienContactsCommand.Search.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienContactsCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienCalendarCommand.Events.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienCalendarCommand.Add.rawValue,
      ),
      InvokeCommandSpec(
        name = AlienMotionCommand.Activity.rawValue,
        availability = InvokeCommandAvailability.MotionActivityAvailable,
      ),
      InvokeCommandSpec(
        name = AlienMotionCommand.Pedometer.rawValue,
        availability = InvokeCommandAvailability.MotionPedometerAvailable,
      ),
      InvokeCommandSpec(
        name = AlienSmsCommand.Send.rawValue,
        availability = InvokeCommandAvailability.SendSmsAvailable,
      ),
      InvokeCommandSpec(
        name = AlienSmsCommand.Search.rawValue,
        availability = InvokeCommandAvailability.RequestableSmsSearchAvailable,
      ),
      InvokeCommandSpec(
        name = AlienCallLogCommand.Search.rawValue,
        availability = InvokeCommandAvailability.CallLogAvailable,
      ),
      InvokeCommandSpec(
        name = "debug.logs",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
      InvokeCommandSpec(
        name = "debug.ed25519",
        availability = InvokeCommandAvailability.DebugBuild,
      ),
    )

  private val byNameInternal: Map<String, InvokeCommandSpec> = all.associateBy { it.name }

  fun find(command: String): InvokeCommandSpec? = byNameInternal[command]

  fun advertisedCapabilities(flags: NodeRuntimeFlags): List<String> =
    capabilityManifest
      .filter { spec ->
        when (spec.availability) {
          NodeCapabilityAvailability.Always -> true
          NodeCapabilityAvailability.CameraEnabled -> flags.cameraEnabled
          NodeCapabilityAvailability.LocationEnabled -> flags.locationEnabled
          NodeCapabilityAvailability.SmsAvailable -> flags.sendSmsAvailable || flags.readSmsAvailable
          NodeCapabilityAvailability.CallLogAvailable -> flags.callLogAvailable
          NodeCapabilityAvailability.VoiceWakeEnabled -> flags.voiceWakeEnabled
          NodeCapabilityAvailability.MotionAvailable -> flags.motionActivityAvailable || flags.motionPedometerAvailable
        }
      }.map { it.name }

  fun advertisedCommands(flags: NodeRuntimeFlags): List<String> =
    all
      .filter { spec ->
        when (spec.availability) {
          InvokeCommandAvailability.Always -> true
          InvokeCommandAvailability.CameraEnabled -> flags.cameraEnabled
          InvokeCommandAvailability.LocationEnabled -> flags.locationEnabled
          InvokeCommandAvailability.SendSmsAvailable -> flags.sendSmsAvailable
          InvokeCommandAvailability.ReadSmsAvailable -> flags.readSmsAvailable
          InvokeCommandAvailability.RequestableSmsSearchAvailable -> flags.smsSearchPossible
          InvokeCommandAvailability.CallLogAvailable -> flags.callLogAvailable
          InvokeCommandAvailability.MotionActivityAvailable -> flags.motionActivityAvailable
          InvokeCommandAvailability.MotionPedometerAvailable -> flags.motionPedometerAvailable
          InvokeCommandAvailability.DebugBuild -> flags.debugBuild
        }
      }.map { it.name }
}
