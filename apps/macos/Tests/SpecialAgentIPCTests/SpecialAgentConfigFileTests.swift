import Foundation
import Testing
@testable import SpecialAgent

@Suite(.serialized)
struct SpecialAgentConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("special-agent-config-\(UUID().uuidString)")
            .appendingPathComponent("special-agent.json")
            .path

        await TestIsolation.withEnvValues(["SPECIAL_AGENT_CONFIG_PATH": override]) {
            #expect(SpecialAgentConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("special-agent-config-\(UUID().uuidString)")
            .appendingPathComponent("special-agent.json")
            .path

        await TestIsolation.withEnvValues(["SPECIAL_AGENT_CONFIG_PATH": override]) {
            SpecialAgentConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(SpecialAgentConfigFile.remoteGatewayPort() == 19999)
            #expect(SpecialAgentConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(SpecialAgentConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(SpecialAgentConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("special-agent-config-\(UUID().uuidString)")
            .appendingPathComponent("special-agent.json")
            .path

        await TestIsolation.withEnvValues(["SPECIAL_AGENT_CONFIG_PATH": override]) {
            SpecialAgentConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            SpecialAgentConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = SpecialAgentConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("special-agent-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "SPECIAL_AGENT_CONFIG_PATH": nil,
            "SPECIAL_AGENT_STATE_DIR": dir,
        ]) {
            #expect(SpecialAgentConfigFile.stateDirURL().path == dir)
            #expect(SpecialAgentConfigFile.url().path == "\(dir)/special-agent.json")
        }
    }
}
