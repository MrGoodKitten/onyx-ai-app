import { Payments } from "@/components/payments/Payments";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
      <div className="bg-gray-800 rounded-2xl p-8 shadow-xl border border-gray-700">
        <h1 className="text-3xl font-bold text-white text-center mb-8">Onyx AI Pricing</h1>
        <Payments />
      </div>
    </div>
  );
}
