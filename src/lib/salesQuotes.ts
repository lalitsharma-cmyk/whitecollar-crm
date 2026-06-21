// Rotating daily sales motivation quotes — attached to the morning-reminder
// notification so each agent gets one fresh quote when they log in at 10 IST.
//
// Deterministic: pick by day-of-year so the whole team sees the same quote
// each day, but no two consecutive days repeat.

const QUOTES: { text: string; author: string }[] = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Approach each customer with the idea of helping them solve a problem, not selling a product.", author: "Brian Tracy" },
  { text: "Successful people do what unsuccessful people are not willing to do.", author: "Jim Rohn" },
  { text: "The harder I work, the luckier I get.", author: "Samuel Goldwyn" },
  { text: "Every no gets you closer to a yes.", author: "Mark Cuban" },
  { text: "Make a customer, not a sale.", author: "Katherine Barchetti" },
  { text: "Pretend that every single person you meet has a sign around his or her neck that says, 'Make me feel important.'", author: "Mary Kay Ash" },
  { text: "Quality performance starts with a positive attitude.", author: "Jeffrey Gitomer" },
  { text: "Selling is essentially a transfer of feelings.", author: "Zig Ziglar" },
  { text: "Stop selling. Start helping.", author: "Zig Ziglar" },
  { text: "If you are not taking care of your customer, your competitor will.", author: "Bob Hooey" },
  { text: "Setting goals is the first step in turning the invisible into the visible.", author: "Tony Robbins" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Success is walking from failure to failure with no loss of enthusiasm.", author: "Winston Churchill" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  { text: "Treat objections as requests for further information.", author: "Brian Tracy" },
  { text: "Your most unhappy customers are your greatest source of learning.", author: "Bill Gates" },
  { text: "Don't sell life insurance. Sell what life insurance can do.", author: "Ben Feldman" },
  { text: "People don't buy what you do; they buy why you do it.", author: "Simon Sinek" },
  { text: "Always deliver more than expected.", author: "Larry Page" },
  { text: "Sales is not about selling anymore, but about building trust and educating.", author: "Siva Devaki" },
  { text: "Establishing trust is better than any sales technique.", author: "Mike Puglia" },
  { text: "If people like you, they'll listen to you. But if they trust you, they'll do business with you.", author: "Zig Ziglar" },
  { text: "Don't be afraid to give up the good to go for the great.", author: "John D. Rockefeller" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "Talk to your customer, not at them.", author: "Tracie Chancellor" },
  { text: "The best salespeople know that their expertise can become their enemy in selling.", author: "Mike Bosworth" },
];

/** Day-of-year stable index — same quote across all agents on a given day. */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86400_000);
}

export function quoteOfTheDay(d: Date = new Date()): { text: string; author: string } {
  const idx = dayOfYear(d) % QUOTES.length;
  return QUOTES[idx];
}

/** Inline preview text for the morning reminder body */
export function quoteOneLine(d: Date = new Date()): string {
  const q = quoteOfTheDay(d);
  return `💡 ${q.text} — ${q.author}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD daily quote (shown under the "Good Morning, {name}" greeting).
// Separate from the morning-reminder set above: real-estate / luxury-sales
// themed, original one-liners (no author attribution), pure + deterministic so
// the whole team sees the SAME quote all day and a NEW one next IST day.
// ─────────────────────────────────────────────────────────────────────────────
export const RE_SALES_QUOTES: string[] = [
  "Fortune is in the follow-up. Every call moves a client closer to closing.",
  "The deal you don't follow up on is the deal your competitor closes.",
  "Luxury sells to those who feel understood, not those who feel sold to.",
  "Discipline in the morning becomes commission in the evening.",
  "A 'maybe' is just a 'yes' that hasn't been followed up enough times.",
  "You don't close clients — you close doubts. Answer the next one.",
  "Consistency beats intensity. One steady call a day builds an empire.",
  "Every unanswered message is a relationship waiting to be restarted.",
  "Sell the lifestyle, not the square footage.",
  "The best time to follow up was yesterday. The second best is now.",
  "Clients buy certainty. Be the calmest, clearest voice they hear today.",
  "Slow replies lose fast deals. Speed is a sales skill.",
  "A full pipeline is built one disciplined follow-up at a time.",
  "Premium buyers remember how you made them feel, long after the price.",
  "Objections aren't walls — they're the client telling you what to solve.",
  "Show up daily and the market eventually shows up for you.",
  "The follow-up is where amateurs quit and professionals get paid.",
  "Treat every lead like it's already a client and it usually becomes one.",
  "Closing is not a moment — it's the sum of every touchpoint before it.",
  "Your next big closing is hiding inside a follow-up you haven't made.",
  "Trust is the real currency of luxury real estate. Earn it on every call.",
  "Be relentless on follow-up and gentle on the client. Both win deals.",
  "A booked site visit beats a hundred 'just thinking about it' chats.",
  "Momentum loves consistency. Make the call before you feel ready.",
  "People don't buy property — they buy a better version of their life.",
  "The agent who follows up first is remembered first.",
  "Discipline is choosing the dial over the distraction.",
  "Warm leads go cold in silence. Keep the conversation alive.",
  "Confidence closes. Preparation creates confidence.",
  "Every 'no today' is data for the 'yes' you'll earn tomorrow.",
  "Luxury is patience plus persistence. Stay in the deal longer than doubt.",
  "Sell with questions, close with clarity, keep with service.",
  "The strongest follow-up isn't pushy — it's genuinely helpful.",
  "Big closings are small habits repeated without skipping a day.",
  "Make one more call than yesterday. That's how pipelines grow.",
  "Your calendar is your conversion rate. Fill it with follow-ups.",
  "Turn 'let me think about it' into 'let's schedule a visit.'",
  "Quiet markets reward loud discipline. Keep dialing.",
];

/** Whole days since the Unix epoch in IST (UTC+5:30) — same for every request
 *  on a given IST day, advances by one each IST midnight. */
export function istDayNumber(nowMs: number): number {
  return Math.floor((nowMs + 5.5 * 3600 * 1000) / 86_400_000);
}

/** The real-estate dashboard quote for a given IST day (stable all day). */
export function dashboardQuoteOfTheDay(istDay: number): string {
  const n = RE_SALES_QUOTES.length;
  const i = ((Math.floor(istDay) % n) + n) % n;
  return RE_SALES_QUOTES[i];
}
