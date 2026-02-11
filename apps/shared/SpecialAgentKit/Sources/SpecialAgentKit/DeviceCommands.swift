import Foundation

public enum SpecialAgentDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum SpecialAgentBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum SpecialAgentThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum SpecialAgentNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum SpecialAgentNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct SpecialAgentBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: SpecialAgentBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: SpecialAgentBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct SpecialAgentThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: SpecialAgentThermalState

    public init(state: SpecialAgentThermalState) {
        self.state = state
    }
}

public struct SpecialAgentStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct SpecialAgentNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: SpecialAgentNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [SpecialAgentNetworkInterfaceType]

    public init(
        status: SpecialAgentNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [SpecialAgentNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct SpecialAgentDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: SpecialAgentBatteryStatusPayload
    public var thermal: SpecialAgentThermalStatusPayload
    public var storage: SpecialAgentStorageStatusPayload
    public var network: SpecialAgentNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: SpecialAgentBatteryStatusPayload,
        thermal: SpecialAgentThermalStatusPayload,
        storage: SpecialAgentStorageStatusPayload,
        network: SpecialAgentNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct SpecialAgentDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
