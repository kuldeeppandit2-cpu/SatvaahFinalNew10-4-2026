// Maps stub for Expo Go simulator testing
import React from 'react';
import { View, Text } from 'react-native';

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const MapView = React.forwardRef(({ style, children, onPress, onRegionChangeComplete }: any, ref: any) => {
  React.useImperativeHandle(ref, () => ({
    animateToRegion: () => {},
    animateCamera: () => {},
    getCamera: async () => ({ center: { latitude: 0, longitude: 0 }, zoom: 10 }),
  }));
  return React.createElement(
    View,
    { style: [style, { backgroundColor: '#e8e8e8', justifyContent: 'center', alignItems: 'center', minHeight: 200 }] },
    React.createElement(Text, { style: { color: '#666', fontSize: 14 } }, '📍 Map (simulator preview)'),
    children
  );
});
MapView.displayName = 'MapView';
export default MapView;

export const Marker = ({ children, onDragEnd }: any) => children ?? null;
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;
