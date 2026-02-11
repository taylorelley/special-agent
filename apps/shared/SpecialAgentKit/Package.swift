// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "SpecialAgentKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "SpecialAgentProtocol", targets: ["SpecialAgentProtocol"]),
        .library(name: "SpecialAgentKit", targets: ["SpecialAgentKit"]),
        .library(name: "SpecialAgentChatUI", targets: ["SpecialAgentChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "SpecialAgentProtocol",
            path: "Sources/SpecialAgentProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SpecialAgentKit",
            dependencies: [
                "SpecialAgentProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/SpecialAgentKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SpecialAgentChatUI",
            dependencies: [
                "SpecialAgentKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/SpecialAgentChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "SpecialAgentKitTests",
            dependencies: ["SpecialAgentKit", "SpecialAgentChatUI"],
            path: "Tests/SpecialAgentKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
