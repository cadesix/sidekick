// react-native-fbsdk-next setup for Swift AppDelegate
// Based on: https://github.com/thebergamo/react-native-fbsdk-next/issues/627

const { withAppDelegate } = require("@expo/config-plugins");

const withFacebookSDK = (config) => {
	return withAppDelegate(config, async (config) => {
		const appDelegate = config.modResults;
		let contents = appDelegate.contents;

		// Add imports
		if (!contents.includes("import FBSDKCoreKit")) {
			const importMatch = contents.match(/import Expo/);
			if (importMatch) {
				const insertIndex = importMatch.index + importMatch[0].length;
				contents =
					contents.slice(0, insertIndex) +
					"\nimport FBSDKCoreKit\nimport AppTrackingTransparency" +
					contents.slice(insertIndex);
			}
		}

		// Add Facebook SDK initialization to didFinishLaunchingWithOptions
		if (!contents.includes("ApplicationDelegate.shared.application")) {
			const methodMatch = contents.match(
				/didFinishLaunchingWithOptions[^{]*\{/,
			);
			if (methodMatch) {
				const methodStart = methodMatch.index + methodMatch[0].length;

				const fbCode = `
    ApplicationDelegate.shared.application(application, didFinishLaunchingWithOptions: launchOptions)
    if #available(iOS 14, *) {
      ATTrackingManager.requestTrackingAuthorization { _ in
        AppEvents.shared.activateApp()
      }
    } else {
      AppEvents.shared.activateApp()
    }
`;

				contents =
					contents.slice(0, methodStart) + fbCode + contents.slice(methodStart);
			}
		}

		appDelegate.contents = contents;
		return config;
	});
};

module.exports = withFacebookSDK;
