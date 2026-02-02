import React from 'react';

export function Payments() {
  const handlePayment = () => {
    window.open('https://buy.stripe.com/6oUbJ350udGt3ZbbgV9Zm01', '_blank');
  };

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <h2 className="text-2xl font-bold mb-4">Onyx AI Premium</h2>
      <p className="text-gray-600 mb-6">Upgrade to access premium AI features</p>
      <button
        onClick={handlePayment}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
      >
        Subscribe Now
      </button>
    </div>
  );
}
