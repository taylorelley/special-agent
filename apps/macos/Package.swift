// swift-tools-version: 6.2
// Package manifest for the SpecialAgent macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "SpecialAgent",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "SpecialAgentIPC", targets: ["SpecialAgentIPC"]),
        .library(name: "SpecialAgentDiscovery", targets: ["SpecialAgentDiscovery"]),
        .executable(name: "SpecialAgent", targets: ["SpecialAgent"]),
        .executable(name: "special-agent-mac", targets: ["SpecialAgentMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/SpecialAgentKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "SpecialAgentIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SpecialAgentDiscovery",
            dependencies: [
                .product(name: "SpecialAgentKit", package: "SpecialAgentKit"),
            ],
            path: "Sources/SpecialAgentDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "SpecialAgent",
            dependencies: [
                "SpecialAgentIPC",
                "SpecialAgentDiscovery",
                .product(name: "SpecialAgentKit", package: "SpecialAgentKit"),
                .product(name: "SpecialAgentChatUI", package: "SpecialAgentKit"),
                .product(name: "SpecialAgentProtocol", package: "SpecialAgentKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/SpecialAgent.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "SpecialAgentMacCLI",
            dependencies: [
                "SpecialAgentDiscovery",
                .product(name: "SpecialAgentKit", package: "SpecialAgentKit"),
                .product(name: "SpecialAgentProtocol", package: "SpecialAgentKit"),
            ],
            path: "Sources/SpecialAgentMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "SpecialAgentIPCTests",
            dependencies: [
                "SpecialAgentIPC",
                "SpecialAgent",
                "SpecialAgentDiscovery",
                .product(name: "SpecialAgentProtocol", package: "SpecialAgentKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
