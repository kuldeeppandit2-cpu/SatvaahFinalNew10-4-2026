/**
 * Firebase Auth stub for Expo Go / simulator testing.
 * Replace with real @react-native-firebase/auth for production build.
 */
const PhoneAuthProvider = {
  credential: (verificationId: string, code: string) => ({ verificationId, code }),
};

const auth: any = () => ({
  signInWithCredential: async (credential: any) => ({
    user: { getIdToken: async () => 'MOCK_FIREBASE_TOKEN_FOR_TESTING' },
  }),
  signInWithPhoneNumber: async (phone: string) => ({
    confirm: async (code: string) => ({
      user: { getIdToken: async () => 'MOCK_FIREBASE_TOKEN_FOR_TESTING' },
    }),
    verificationId: 'MOCK_VERIFICATION_ID',
  }),
  currentUser: null,
  onAuthStateChanged: (cb: any) => { cb(null); return () => {}; },
});

auth.PhoneAuthProvider = PhoneAuthProvider;
export default auth;
