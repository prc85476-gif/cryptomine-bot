const { Resvg } = require('@resvg/resvg-js');

/**
 * Generate a unique, beautiful 4-digit Security Verification Card image (PNG Buffer)
 */
function generateSecurityCard({ code, amount, network, address, dateStr }) {
  // Select dynamic color themes so each card looks distinct
  const colorThemes = [
    { bg1: '#0a0f1d', bg2: '#161938', bg3: '#05070e', accent1: '#6366f1', accent2: '#a855f7', gold: '#fbbf24', glow: '#818cf8' },
    { bg1: '#061a14', bg2: '#0b2e24', bg3: '#04100c', accent1: '#10b981', accent2: '#06b6d4', gold: '#34d399', glow: '#2dd4bf' },
    { bg1: '#180b26', bg2: '#2b1046', bg3: '#0d0417', accent1: '#ec4899', accent2: '#8b5cf6', gold: '#f43f5e', glow: '#f472b6' },
    { bg1: '#0d1829', bg2: '#132847', bg3: '#070c17', accent1: '#38bdf8', accent2: '#3b82f6', gold: '#f59e0b', glow: '#60a5fa' },
  ];
  
  // Pick theme based on code digits
  const themeIndex = (parseInt(code, 10) || 0) % colorThemes.length;
  const theme = colorThemes[themeIndex];
  
  const shortAddr = address ? `${address.substring(0, 8)}...${address.substring(address.length - 6)}` : '0x...';
  const digits = String(code).padStart(4, '0').split('');
  const nowStr = dateStr || new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="460" viewBox="0 0 800 460">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.bg1}" />
      <stop offset="50%" stop-color="${theme.bg2}" />
      <stop offset="100%" stop-color="${theme.bg3}" />
    </linearGradient>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.9" />
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95" />
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${theme.accent1}" />
      <stop offset="100%" stop-color="${theme.accent2}" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${theme.gold}" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>
    <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background Canvas with Cyber Grid lines -->
  <rect width="800" height="460" rx="28" fill="url(#bgGrad)" stroke="#1e293b" stroke-width="3" />
  
  <!-- Ambient Glow Orbs -->
  <circle cx="120" cy="90" r="130" fill="${theme.accent1}" opacity="0.15" />
  <circle cx="680" cy="370" r="150" fill="${theme.accent2}" opacity="0.12" />
  <circle cx="400" cy="220" r="180" fill="${theme.glow}" opacity="0.08" />

  <!-- Grid Accent Lines -->
  <line x1="40" y1="70" x2="760" y2="70" stroke="#334155" stroke-dasharray="6,6" opacity="0.4" />
  <line x1="40" y1="400" x2="760" y2="400" stroke="#334155" stroke-dasharray="6,6" opacity="0.4" />

  <!-- Top Header -->
  <g transform="translate(40, 45)">
    <!-- Security Shield Icon -->
    <rect x="0" y="0" width="36" height="36" rx="10" fill="url(#accentGrad)" />
    <text x="18" y="24" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="18" font-weight="bold">🛡</text>
    <text x="48" y="16" fill="#94a3b8" font-family="Arial, sans-serif" font-size="11" font-weight="bold" letter-spacing="2">CRYPTOMINE PROTOCOL • SECURITY SYSTEM</text>
    <text x="48" y="32" fill="#38bdf8" font-family="Arial, sans-serif" font-size="14" font-weight="bold">Withdrawal Verification PIN</text>
  </g>
  
  <!-- Right Header: Status Badge -->
  <g transform="translate(630, 42)">
    <rect x="0" y="0" width="130" height="32" rx="16" fill="#064e3b" stroke="#10b981" stroke-width="1.5" />
    <circle cx="18" cy="16" r="4" fill="#34d399" />
    <text x="30" y="21" fill="#6ee7b7" font-family="Arial, sans-serif" font-size="11" font-weight="bold" letter-spacing="1">LIVE SECURED</text>
  </g>

  <!-- Central Main Card -->
  <rect x="40" y="95" width="720" height="290" rx="22" fill="url(#cardGrad)" stroke="url(#accentGrad)" stroke-width="2" />

  <!-- Subheading inside Card -->
  <text x="400" y="132" text-anchor="middle" fill="#94a3b8" font-family="Arial, sans-serif" font-size="13" font-weight="bold" letter-spacing="1.5">ENTER THIS 4-DIGIT CODE IN THE APP TO PROCEED</text>

  <!-- 4-Digit Code Box Container -->
  <g transform="translate(180, 150)">
    <!-- Box 1 -->
    <rect x="0" y="0" width="95" height="100" rx="16" fill="#090d16" stroke="${theme.glow}" stroke-width="2.5" />
    <text x="47" y="68" text-anchor="middle" fill="url(#goldGrad)" font-family="monospace, Arial, sans-serif" font-size="54" font-weight="bold">${digits[0]}</text>

    <!-- Box 2 -->
    <rect x="115" y="0" width="95" height="100" rx="16" fill="#090d16" stroke="${theme.glow}" stroke-width="2.5" />
    <text x="162" y="68" text-anchor="middle" fill="url(#goldGrad)" font-family="monospace, Arial, sans-serif" font-size="54" font-weight="bold">${digits[1]}</text>

    <!-- Box 3 -->
    <rect x="230" y="0" width="95" height="100" rx="16" fill="#090d16" stroke="${theme.glow}" stroke-width="2.5" />
    <text x="277" y="68" text-anchor="middle" fill="url(#goldGrad)" font-family="monospace, Arial, sans-serif" font-size="54" font-weight="bold">${digits[2]}</text>

    <!-- Box 4 -->
    <rect x="345" y="0" width="95" height="100" rx="16" fill="#090d16" stroke="${theme.glow}" stroke-width="2.5" />
    <text x="392" y="68" text-anchor="middle" fill="url(#goldGrad)" font-family="monospace, Arial, sans-serif" font-size="54" font-weight="bold">${digits[3]}</text>
  </g>

  <!-- Info Pill Badges inside Card -->
  <g transform="translate(60, 275)">
    <!-- Amount Pill -->
    <rect x="0" y="0" width="210" height="42" rx="12" fill="#0b1120" stroke="#334155" stroke-width="1" />
    <text x="15" y="17" fill="#64748b" font-family="Arial, sans-serif" font-size="10" font-weight="bold">AMOUNT</text>
    <text x="15" y="34" fill="#f8fafc" font-family="Arial, sans-serif" font-size="14" font-weight="bold">💰 ${amount || '0.15'} USDT</text>

    <!-- Network Pill -->
    <rect x="225" y="0" width="220" height="42" rx="12" fill="#0b1120" stroke="#334155" stroke-width="1" />
    <text x="240" y="17" fill="#64748b" font-family="Arial, sans-serif" font-size="10" font-weight="bold">NETWORK</text>
    <text x="240" y="34" fill="#f8fafc" font-family="Arial, sans-serif" font-size="14" font-weight="bold">🌐 ${network || 'BEP-20 (BNB)'}</text>

    <!-- Address Pill -->
    <rect x="460" y="0" width="220" height="42" rx="12" fill="#0b1120" stroke="#334155" stroke-width="1" />
    <text x="475" y="17" fill="#64748b" font-family="Arial, sans-serif" font-size="10" font-weight="bold">DESTINATION</text>
    <text x="475" y="34" fill="#38bdf8" font-family="monospace, Arial, sans-serif" font-size="13" font-weight="bold">📍 ${shortAddr}</text>
  </g>

  <!-- Protection Guarantee Footer -->
  <g transform="translate(40, 335)">
    <!-- Green Shield Highlight Box -->
    <rect x="20" y="0" width="680" height="36" rx="10" fill="#064e3b" fill-opacity="0.4" stroke="#10b981" stroke-width="1" />
    <text x="360" y="23" text-anchor="middle" fill="#34d399" font-family="Arial, sans-serif" font-size="13" font-weight="bold">
      🛡️ YOUR FUND IS 100% PROTECTED • ONE-TIME USE PIN
    </text>
  </g>

  <!-- Bottom Details -->
  <text x="50" y="430" fill="#64748b" font-family="Arial, sans-serif" font-size="11">⏰ Requested: ${nowStr}</text>
  <text x="750" y="430" text-anchor="end" fill="#64748b" font-family="Arial, sans-serif" font-size="11">Expires in 10 minutes • Never share your PIN</text>
</svg>
`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 800 }
  });
  return resvg.render().asPng();
}

module.exports = {
  generateSecurityCard
};
