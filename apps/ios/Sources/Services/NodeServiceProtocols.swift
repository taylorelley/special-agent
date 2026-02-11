import CoreLocation
import Foundation
import SpecialAgentKit
import UIKit

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: SpecialAgentCameraSnapParams) async throws -> (format: String, base64: String, width: Int, height: Int)
    func clip(params: SpecialAgentCameraClipParams) async throws -> (format: String, base64: String, durationMs: Int, hasAudio: Bool)
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: SpecialAgentLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: SpecialAgentLocationGetParams,
        desiredAccuracy: SpecialAgentLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> SpecialAgentDeviceStatusPayload
    func info() -> SpecialAgentDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: SpecialAgentPhotosLatestParams) async throws -> SpecialAgentPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: SpecialAgentContactsSearchParams) async throws -> SpecialAgentContactsSearchPayload
    func add(params: SpecialAgentContactsAddParams) async throws -> SpecialAgentContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: SpecialAgentCalendarEventsParams) async throws -> SpecialAgentCalendarEventsPayload
    func add(params: SpecialAgentCalendarAddParams) async throws -> SpecialAgentCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: SpecialAgentRemindersListParams) async throws -> SpecialAgentRemindersListPayload
    func add(params: SpecialAgentRemindersAddParams) async throws -> SpecialAgentRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: SpecialAgentMotionActivityParams) async throws -> SpecialAgentMotionActivityPayload
    func pedometer(params: SpecialAgentPedometerParams) async throws -> SpecialAgentPedometerPayload
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
