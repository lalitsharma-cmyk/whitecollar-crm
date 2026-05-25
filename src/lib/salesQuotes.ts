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
