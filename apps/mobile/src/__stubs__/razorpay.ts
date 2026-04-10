// Razorpay stub for Expo Go — simulates successful payment
const RazorpayCheckout = {
  open: async (options: any) => {
    console.log('[STUB] Razorpay.open called with:', options.order_id);
    return {
      razorpay_payment_id: 'pay_STUB_' + Date.now(),
      razorpay_order_id: options.order_id,
      razorpay_signature: 'STUB_SIGNATURE',
    };
  },
};
export default RazorpayCheckout;
