import Foundation

public enum SpecialAgentChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(SpecialAgentChatEventPayload)
    case agent(SpecialAgentAgentEventPayload)
    case seqGap
}

public protocol SpecialAgentChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> SpecialAgentChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [SpecialAgentChatAttachmentPayload]) async throws -> SpecialAgentChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> SpecialAgentChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<SpecialAgentChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension SpecialAgentChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "SpecialAgentChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> SpecialAgentChatSessionsListResponse {
        throw NSError(
            domain: "SpecialAgentChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
