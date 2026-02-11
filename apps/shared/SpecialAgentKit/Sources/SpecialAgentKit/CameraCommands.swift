import Foundation

public enum SpecialAgentCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum SpecialAgentCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum SpecialAgentCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum SpecialAgentCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct SpecialAgentCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: SpecialAgentCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: SpecialAgentCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: SpecialAgentCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: SpecialAgentCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct SpecialAgentCameraClipParams: Codable, Sendable, Equatable {
    public var facing: SpecialAgentCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: SpecialAgentCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: SpecialAgentCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: SpecialAgentCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
