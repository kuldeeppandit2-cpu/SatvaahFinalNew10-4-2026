/**
 * Branch.io stub for Expo Go / simulator testing.
 */
export interface BranchParams {
  [key: string]: any;
}
const branch = {
  subscribe: (_: any) => () => {},
  getLatestReferringParams: async () => ({}),
  createBranchUniversalObject: async () => ({
    generateShortUrl: async () => ({ url: '' }),
    showShareSheet: async () => {},
  }),
};
export default branch;
