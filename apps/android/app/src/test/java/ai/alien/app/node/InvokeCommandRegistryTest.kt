package ai.alien.app.node

import ai.alien.app.protocol.AlienCalendarCommand
import ai.alien.app.protocol.AlienCallLogCommand
import ai.alien.app.protocol.AlienCameraCommand
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InvokeCommandRegistryTest {
  private val coreCapabilities =
    setOf(
      AlienCapability.Canvas.rawValue,
      AlienCapability.Device.rawValue,
      AlienCapability.Notifications.rawValue,
      AlienCapability.System.rawValue,
      AlienCapability.Talk.rawValue,
      AlienCapability.Photos.rawValue,
      AlienCapability.Contacts.rawValue,
      AlienCapability.Calendar.rawValue,
    )

  private val optionalCapabilities =
    setOf(
      AlienCapability.Camera.rawValue,
      AlienCapability.Location.rawValue,
      AlienCapability.Sms.rawValue,
      AlienCapability.CallLog.rawValue,
      AlienCapability.VoiceWake.rawValue,
      AlienCapability.Motion.rawValue,
    )

  private val coreCommands =
    setOf(
      AlienDeviceCommand.Status.rawValue,
      AlienDeviceCommand.Info.rawValue,
      AlienDeviceCommand.Permissions.rawValue,
      AlienDeviceCommand.Health.rawValue,
      AlienNotificationsCommand.List.rawValue,
      AlienNotificationsCommand.Actions.rawValue,
      AlienSystemCommand.Notify.rawValue,
      AlienTalkCommand.PttStart.rawValue,
      AlienTalkCommand.PttStop.rawValue,
      AlienTalkCommand.PttCancel.rawValue,
      AlienTalkCommand.PttOnce.rawValue,
      AlienPhotosCommand.Latest.rawValue,
      AlienContactsCommand.Search.rawValue,
      AlienContactsCommand.Add.rawValue,
      AlienCalendarCommand.Events.rawValue,
      AlienCalendarCommand.Add.rawValue,
    )

  private val optionalCommands =
    setOf(
      AlienCameraCommand.Snap.rawValue,
      AlienCameraCommand.Clip.rawValue,
      AlienCameraCommand.List.rawValue,
      AlienLocationCommand.Get.rawValue,
      AlienMotionCommand.Activity.rawValue,
      AlienMotionCommand.Pedometer.rawValue,
      AlienSmsCommand.Send.rawValue,
      AlienSmsCommand.Search.rawValue,
      AlienCallLogCommand.Search.rawValue,
    )

  private val debugCommands = setOf("debug.logs", "debug.ed25519")

  @Test
  fun advertisedCapabilities_respectsFeatureAvailability() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags())

    assertContainsAll(capabilities, coreCapabilities)
    assertMissingAll(capabilities, optionalCapabilities)
  }

  @Test
  fun advertisedCapabilities_includesFeatureCapabilitiesWhenEnabled() {
    val capabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          smsSearchPossible = true,
          callLogAvailable = true,
          voiceWakeEnabled = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
        ),
      )

    assertContainsAll(capabilities, coreCapabilities + optionalCapabilities)
  }

  @Test
  fun advertisedCommands_respectsFeatureAvailability() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags())

    assertContainsAll(commands, coreCommands)
    assertMissingAll(commands, optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_includesFeatureCommandsWhenEnabled() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          smsSearchPossible = true,
          callLogAvailable = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          debugBuild = true,
        ),
      )

    assertContainsAll(commands, coreCommands + optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_onlyIncludesSupportedMotionCommands() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          sendSmsAvailable = false,
          readSmsAvailable = false,
          smsSearchPossible = false,
          callLogAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = true,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertTrue(commands.contains(AlienMotionCommand.Activity.rawValue))
    assertFalse(commands.contains(AlienMotionCommand.Pedometer.rawValue))
  }

  @Test
  fun advertisedCommands_splitsSmsSendAndSearchAvailability() {
    val readOnlyCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(readSmsAvailable = true, smsSearchPossible = true),
      )
    val sendOnlyCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(sendSmsAvailable = true),
      )
    val requestableSearchCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(smsSearchPossible = true),
      )

    assertTrue(readOnlyCommands.contains(AlienSmsCommand.Search.rawValue))
    assertFalse(readOnlyCommands.contains(AlienSmsCommand.Send.rawValue))
    assertTrue(sendOnlyCommands.contains(AlienSmsCommand.Send.rawValue))
    assertFalse(sendOnlyCommands.contains(AlienSmsCommand.Search.rawValue))
    assertTrue(requestableSearchCommands.contains(AlienSmsCommand.Search.rawValue))
  }

  @Test
  fun advertisedCapabilities_includeSmsWhenEitherSmsPathIsAvailable() {
    val readOnlyCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(readSmsAvailable = true),
      )
    val sendOnlyCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(sendSmsAvailable = true),
      )
    val requestableSearchCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(smsSearchPossible = true),
      )

    assertTrue(readOnlyCapabilities.contains(AlienCapability.Sms.rawValue))
    assertTrue(sendOnlyCapabilities.contains(AlienCapability.Sms.rawValue))
    assertFalse(requestableSearchCapabilities.contains(AlienCapability.Sms.rawValue))
  }

  @Test
  fun advertisedCommands_excludesCallLogWhenUnavailable() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags(callLogAvailable = false))

    assertFalse(commands.contains(AlienCallLogCommand.Search.rawValue))
  }

  @Test
  fun advertisedCapabilities_excludesCallLogWhenUnavailable() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags(callLogAvailable = false))

    assertFalse(capabilities.contains(AlienCapability.CallLog.rawValue))
  }

  @Test
  fun advertisedCapabilities_includesVoiceWakeWithoutAdvertisingCommands() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags(voiceWakeEnabled = true))
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags(voiceWakeEnabled = true))

    assertTrue(capabilities.contains(AlienCapability.VoiceWake.rawValue))
    assertFalse(commands.any { it.contains("voice", ignoreCase = true) })
  }

  @Test
  fun find_returnsForegroundMetadataForCameraCommands() {
    val list = InvokeCommandRegistry.find(AlienCameraCommand.List.rawValue)
    val location = InvokeCommandRegistry.find(AlienLocationCommand.Get.rawValue)

    assertNotNull(list)
    assertEquals(true, list?.requiresForeground)
    assertNotNull(location)
    assertEquals(false, location?.requiresForeground)
  }

  @Test
  fun find_returnsNullForUnknownCommand() {
    assertNull(InvokeCommandRegistry.find("not.real"))
  }

  private fun defaultFlags(
    cameraEnabled: Boolean = false,
    locationEnabled: Boolean = false,
    sendSmsAvailable: Boolean = false,
    readSmsAvailable: Boolean = false,
    smsSearchPossible: Boolean = false,
    callLogAvailable: Boolean = false,
    voiceWakeEnabled: Boolean = false,
    motionActivityAvailable: Boolean = false,
    motionPedometerAvailable: Boolean = false,
    debugBuild: Boolean = false,
  ): NodeRuntimeFlags =
    NodeRuntimeFlags(
      cameraEnabled = cameraEnabled,
      locationEnabled = locationEnabled,
      sendSmsAvailable = sendSmsAvailable,
      readSmsAvailable = readSmsAvailable,
      smsSearchPossible = smsSearchPossible,
      callLogAvailable = callLogAvailable,
      voiceWakeEnabled = voiceWakeEnabled,
      motionActivityAvailable = motionActivityAvailable,
      motionPedometerAvailable = motionPedometerAvailable,
      debugBuild = debugBuild,
    )

  private fun assertContainsAll(
    actual: List<String>,
    expected: Set<String>,
  ) {
    expected.forEach { value -> assertTrue(actual.contains(value)) }
  }

  private fun assertMissingAll(
    actual: List<String>,
    forbidden: Set<String>,
  ) {
    forbidden.forEach { value -> assertFalse(actual.contains(value)) }
  }
}
