import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "~/imessage/theme";
import { GRAVITY_PIXEL_CONFIG, GRAVITY_PIXEL_LOADER } from "~/lib/gravity-pixel";

export function GravityBrowser({
  url,
  visible,
  onClose,
}: {
  url: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Sponsored link</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.webView}>
          <WebView
            source={{ uri: url }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            injectedJavaScriptBeforeContentLoaded={GRAVITY_PIXEL_CONFIG}
            injectedJavaScript={GRAVITY_PIXEL_LOADER}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
          />
          {loading ? (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator color={colors.gray} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.gray5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 48,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  title: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
  },
  done: {
    color: colors.blue,
    fontSize: 16,
    fontWeight: "600",
  },
  webView: {
    flex: 1,
  },
  loading: {
    alignItems: "center",
    backgroundColor: colors.background,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
