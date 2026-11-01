import React from 'react';
import { Text, View } from 'react-native';
import { ui } from '../design/theme';
export default function VideoSurface(): React.JSX.Element {
  return (
    <View style={ui.card}>
      <Text style={ui.text}>Video window</Text>
      <Text style={ui.muted}>
        Video renders in a separate native window belonging to this app.
        Transport controls remain available here and by keyboard in that window.
      </Text>
    </View>
  );
}
