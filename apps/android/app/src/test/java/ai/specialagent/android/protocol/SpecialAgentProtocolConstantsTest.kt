package ai.specialagent.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class SpecialAgentProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", SpecialAgentCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", SpecialAgentCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", SpecialAgentCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", SpecialAgentCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", SpecialAgentCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", SpecialAgentCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", SpecialAgentCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", SpecialAgentCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", SpecialAgentCapability.Canvas.rawValue)
    assertEquals("camera", SpecialAgentCapability.Camera.rawValue)
    assertEquals("screen", SpecialAgentCapability.Screen.rawValue)
    assertEquals("voiceWake", SpecialAgentCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", SpecialAgentScreenCommand.Record.rawValue)
  }
}
