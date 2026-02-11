import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-special-agent writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.special-agent.mac"
let gatewayLaunchdLabel = "ai.special-agent.gateway"
let onboardingVersionKey = "special-agent.onboardingVersion"
let onboardingSeenKey = "special-agent.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "special-agent.pauseEnabled"
let iconAnimationsEnabledKey = "special-agent.iconAnimationsEnabled"
let swabbleEnabledKey = "special-agent.swabbleEnabled"
let swabbleTriggersKey = "special-agent.swabbleTriggers"
let voiceWakeTriggerChimeKey = "special-agent.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "special-agent.voiceWakeSendChime"
let showDockIconKey = "special-agent.showDockIcon"
let defaultVoiceWakeTriggers = ["special-agent"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "special-agent.voiceWakeMicID"
let voiceWakeMicNameKey = "special-agent.voiceWakeMicName"
let voiceWakeLocaleKey = "special-agent.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "special-agent.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "special-agent.voicePushToTalkEnabled"
let talkEnabledKey = "special-agent.talkEnabled"
let iconOverrideKey = "special-agent.iconOverride"
let connectionModeKey = "special-agent.connectionMode"
let remoteTargetKey = "special-agent.remoteTarget"
let remoteIdentityKey = "special-agent.remoteIdentity"
let remoteProjectRootKey = "special-agent.remoteProjectRoot"
let remoteCliPathKey = "special-agent.remoteCliPath"
let canvasEnabledKey = "special-agent.canvasEnabled"
let cameraEnabledKey = "special-agent.cameraEnabled"
let systemRunPolicyKey = "special-agent.systemRunPolicy"
let systemRunAllowlistKey = "special-agent.systemRunAllowlist"
let systemRunEnabledKey = "special-agent.systemRunEnabled"
let locationModeKey = "special-agent.locationMode"
let locationPreciseKey = "special-agent.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "special-agent.peekabooBridgeEnabled"
let deepLinkKeyKey = "special-agent.deepLinkKey"
let modelCatalogPathKey = "special-agent.modelCatalogPath"
let modelCatalogReloadKey = "special-agent.modelCatalogReload"
let cliInstallPromptedVersionKey = "special-agent.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "special-agent.heartbeatsEnabled"
let debugPaneEnabledKey = "special-agent.debugPaneEnabled"
let debugFileLogEnabledKey = "special-agent.debug.fileLogEnabled"
let appLogLevelKey = "special-agent.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
