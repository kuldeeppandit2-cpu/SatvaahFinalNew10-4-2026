// @gorhom/bottom-sheet stub for Expo Go
import React from 'react';
import { View, Modal, StyleSheet } from 'react-native';

const BottomSheet = React.forwardRef(({ children, snapPoints, index = 0, onChange, backgroundStyle, handleIndicatorStyle }: any, ref: any) => {
  const [visible, setVisible] = React.useState(index >= 0);
  React.useImperativeHandle(ref, () => ({
    expand: () => setVisible(true),
    collapse: () => setVisible(false),
    close: () => { setVisible(false); onChange?.(-1); },
    snapToIndex: (i: number) => { setVisible(i >= 0); onChange?.(i); },
  }));
  if (!visible) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', zIndex: 999 }]}>
      <View style={[{ backgroundColor: 'white', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, maxHeight: '80%' }, backgroundStyle]}>
        {children}
      </View>
    </View>
  );
});
export default BottomSheet;
export const BottomSheetView = ({ children, style }: any) => React.createElement(View, { style }, children);
export const BottomSheetScrollView = ({ children, style }: any) => React.createElement(View, { style }, children);
export const BottomSheetFlatList = ({ data, renderItem, keyExtractor, style }: any) => 
  React.createElement(View, { style }, data?.map((item: any, i: number) => renderItem({ item, index: i })));
export const BottomSheetTextInput = (props: any) => {
  const { TextInput } = require('react-native');
  return React.createElement(TextInput, props);
};

export const BottomSheetBackdrop = ({ children }: any) => null;
export type BottomSheetBackdropProps = any;
