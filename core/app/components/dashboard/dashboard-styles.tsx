export default function DashboardStyles() {
  return (
    <style jsx global>{`
      @keyframes buddy-toast-in {
        from { opacity: 0; transform: translateY(-8px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes buddy-bubble-in {
        from { opacity: 0; transform: translateY(8px) scale(0.96); transform-origin: bottom right; }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes buddy-magnet-pulse {
        0%, 100% { transform: scale(1); opacity: 0.85; }
        50% { transform: scale(1.06); opacity: 1; }
      }
      @keyframes buddy-magnet-ping {
        0% { transform: scale(1); opacity: 0.7; }
        100% { transform: scale(1.45); opacity: 0; }
      }
      @keyframes buddy-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4%); }
      }
      @keyframes buddy-shake {
        0%   { transform: translate(0, 0) rotate(0); }
        15%  { transform: translate(-6%, 1%) rotate(-6deg); }
        30%  { transform: translate(5%, -1%) rotate(5deg); }
        45%  { transform: translate(-4%, 2%) rotate(-4deg); }
        60%  { transform: translate(4%, -2%) rotate(3deg); }
        75%  { transform: translate(-2%, 1%) rotate(-1.5deg); }
        100% { transform: translate(0, 0) rotate(0); }
      }
    `}</style>
  );
}
