import { PrismaClient, Role, LeadSource, LeadStatus, AIScore, ProjectStatus, UnitStatus, ActivityType, ActivityStatus, CallDirection, CallOutcome, Potential, FundReadiness, MoodStatus, InvestTimeline } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding White Collar Realty CRM (Dubai workflow)…');

  // ---------- Users ----------
  const pw = await bcrypt.hash('demo1234', 10);

  const users = await Promise.all([
    prisma.user.upsert({ where: { email: 'lalit@whitecollarrealty.com' }, update: {}, create: { email: 'lalit@whitecollarrealty.com', name: 'Lalit Sharma', passwordHash: pw, role: Role.ADMIN, team: 'HQ', avatarColor: 'bg-amber-500' } }),
    prisma.user.upsert({ where: { email: 'nishu@whitecollarrealty.com' }, update: {}, create: { email: 'nishu@whitecollarrealty.com', name: 'Nishu Singh', passwordHash: pw, role: Role.MANAGER, team: 'Dubai', avatarColor: 'bg-indigo-500' } }),
    prisma.user.upsert({ where: { email: 'krish@whitecollarrealty.com' }, update: {}, create: { email: 'krish@whitecollarrealty.com', name: 'Krish Swami', passwordHash: pw, role: Role.AGENT, team: 'Dubai', avatarColor: 'bg-sky-500' } }),
    prisma.user.upsert({ where: { email: 'aisha@whitecollarrealty.com' }, update: {}, create: { email: 'aisha@whitecollarrealty.com', name: 'Aisha Siddiqui', passwordHash: pw, role: Role.AGENT, team: 'India', avatarColor: 'bg-emerald-500' } }),
    prisma.user.upsert({ where: { email: 'karan@whitecollarrealty.com' }, update: {}, create: { email: 'karan@whitecollarrealty.com', name: 'Karan Patel', passwordHash: pw, role: Role.AGENT, team: 'India', avatarColor: 'bg-rose-500' } }),
    prisma.user.upsert({ where: { email: 'divya@whitecollarrealty.com' }, update: {}, create: { email: 'divya@whitecollarrealty.com', name: 'Divya Menon', passwordHash: pw, role: Role.AGENT, team: 'India', avatarColor: 'bg-violet-500' } }),
  ]);
  const [admin, nishu, krish, aisha, karan, divya] = users;
  console.log(`✓ ${users.length} users`);

  // ---------- Projects + Units ----------
  await prisma.leadProperty.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.project.deleteMany();

  const projects = await Promise.all([
    prisma.project.create({ data: { name: 'Marina Bay Residences', developer: 'Emaar', city: 'Dubai', area: 'Dubai Marina', country: 'UAE', status: ProjectStatus.OFF_PLAN, handoverDate: new Date('2027-12-01'), heroColor: 'from-[#0b1a33] to-[#c9a24b]', rera: 'DUB-EMAAR-1188' } }),
    prisma.project.create({ data: { name: 'Burj Vista', developer: 'Emaar', city: 'Dubai', area: 'Downtown Dubai', country: 'UAE', status: ProjectStatus.READY, heroColor: 'from-[#7e22ce] to-[#c084fc]' } }),
    prisma.project.create({ data: { name: 'Sobha Hartland', developer: 'Sobha', city: 'Dubai', area: 'Mohammed Bin Rashid City', country: 'UAE', status: ProjectStatus.UNDER_CONSTRUCTION, heroColor: 'from-[#16a34a] to-[#84cc16]' } }),
    prisma.project.create({ data: { name: 'Palm Royale Beach', developer: 'Nakheel', city: 'Dubai', area: 'Palm Jumeirah', country: 'UAE', status: ProjectStatus.OFF_PLAN, heroColor: 'from-[#0891b2] to-[#67e8f9]' } }),
    prisma.project.create({ data: { name: 'DLF The Camellias', developer: 'DLF', city: 'Gurgaon', area: 'Sector 42', country: 'India', status: ProjectStatus.READY, heroColor: 'from-[#1e3a8a] to-[#0ea5e9]', rera: 'HR-RERA-GGM-2018' } }),
    prisma.project.create({ data: { name: 'Lodha Park', developer: 'Lodha', city: 'Mumbai', area: 'Bandra Kurla Complex', country: 'India', status: ProjectStatus.READY, heroColor: 'from-[#dc2626] to-[#f59e0b]' } }),
  ]);

  const units: any[] = [];
  for (const project of projects) {
    const configs = project.name.includes('Camellias') ? ['4BHK'] : project.name.includes('Burj') ? ['1BHK', '2BHK', '3BHK', 'PH'] : ['1BHK', '2BHK', '3BHK'];
    let unitIdx = 1;
    for (const cfg of configs) {
      for (let i = 0; i < 4; i++) {
        const u = await prisma.unit.create({
          data: {
            projectId: project.id,
            code: `T-B-${1800 + unitIdx * 4 + i}`,
            configuration: cfg,
            carpetArea: cfg === '1BHK' ? 720 : cfg === '2BHK' ? 1180 : cfg === '3BHK' ? 1620 : cfg === '4BHK' ? 4200 : 6400,
            floor: 18 + (i % 12),
            view: ['Sea', 'Marina', 'City', 'Park', 'Pool'][i % 5],
            priceBase: cfg === '1BHK' ? 1900000 : cfg === '2BHK' ? 3200000 : cfg === '3BHK' ? 4800000 : cfg === '4BHK' ? 12400000 : 6400000,
            status: i === 0 ? UnitStatus.SOLD : i === 1 ? UnitStatus.HOLD : UnitStatus.AVAILABLE,
          },
        });
        units.push(u);
      }
      unitIdx++;
    }
  }
  console.log(`✓ ${projects.length} projects, ${units.length} units (Dubai-tier AED pricing)`);

  // ---------- Wipe and reseed leads with Dubai workflow depth ----------
  await prisma.activity.deleteMany();
  await prisma.callLog.deleteMany();
  await prisma.note.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.lead.deleteMany();

  // Sample "Who Is Client" depth narratives — Lalit's priority
  const depthNarratives = [
    "NRI investor based in Dubai for 6+ years, originally from Mumbai. Works as Senior Director at a Big-4 consulting firm (DIFC). Husband already owns a 2BR at Burj Vista bought through us in 2024. Now looking for a 2-3BR for his parents who are relocating from Mumbai next year. Open to off-plan but prefers ready. Strong preference for sea/marina view. Decisions made jointly with husband — both need to view. Budget flexible if right unit.",
    "Indian businessman, runs an export business out of Sharjah. Wants Dubai address for visa stability and as a hedge. Has cash reserves but prefers 50% down + payment plan. Has visited Marina Bay show flat twice. Wife (in Mumbai) is the actual decision maker — needs to fly in. Concerned about service charges post-handover. Asked specifically about RERA escrow process.",
    "Young couple, both pilots based in Dubai. Both Indian nationals. Looking for first own home (currently renting in Sports City). Budget tight, looking at studio/1BR off-plan with extended payment. Highly engaged on WhatsApp, replies within minutes. Pre-approved for 75% Emirates NBD mortgage. Need to close within 60 days as rental ends.",
    "UK-based investor (British-Indian), visiting Dubai twice a year. Looking to park GBP-hedged investments. Already owns 1 unit in JLT (rental yield 6.2%). Specifically asked for high-yield off-plan with handover in 18-24 months. Doesn't care about view — wants rental ROI. Will close via POA if numbers work.",
    "Dubai-based family, husband is a UAE national, wife is Indian. They have 3 kids. Looking for 4BR villa or townhouse, NOT apartment. Budget AED 5-7M. Have visited Damac Hills 2 — didn't like. Want quieter community. Worth showing Sobha Hartland villas. Husband prefers golf-access amenity.",
    "Lead from event — Dubai Property Expo. Came as 'just browsing' but actually has a serious need. Recently sold property in Bangalore (₹4.5Cr), looking to redeploy into Dubai. Tax-conscious. Wants ready inventory. Mother lives in Dubai with sister, prefers downtown for proximity. Initial chat went 25 mins — good rapport.",
    "Indian doctor working at Cleveland Clinic Abu Dhabi. Family of 4, currently renting in Khalifa City. Wants Dubai weekend home — not primary residence. Budget AED 1.5-2.2M for a 1BR/studio. Open to Sharjah border areas if price right. Decision in next 3-4 months — depends on visa renewal outcome.",
    "South African-Indian couple, both 60+. Selling their Johannesburg home, retirement plan is to split between Dubai and Goa. Looking for low-maintenance 2BR with concierge. Burj Khalifa view is a non-negotiable (emotional reason — first date there). Cash buyer. Slow to make decisions but very loyal once decided.",
    "First-time enquiry from Mumbai. High-net-worth (textile family). NEVER visited Dubai for property. Currently planning a Dec visit. Should send Dubai investment guide + arrange virtual walkthroughs to warm up before Dec. Budget mentioned was 'open' — needs proper qualifying call to anchor.",
    "Pakistani national working in Dubai construction. Indian wife. Looking for residency-by-investment route (AED 2M for golden visa). Will buy whatever qualifies. Limited interest in unit features — purely visa-driven. Cash ready. Easy close if we point at right inventory.",
  ];

  const agents = [nishu, krish, aisha, karan, divya];
  const firstNames = ['Priya', 'Aman', 'Rohan', 'Suresh', 'Ankit', 'Meera', 'Faisal', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Nikhil', 'Pooja', 'Aditya', 'Riya', 'Sandeep', 'Tara', 'Yash', 'Ishita', 'Manav'];
  const lastNames = ['Sharma', 'Khanna', 'Mehta', 'Iyer', 'Verma', 'Pillai', 'Al Mansoori', 'Singh', 'Kapoor', 'Roy', 'Patel', 'Reddy', 'Gupta', 'Joshi', 'Nair', 'Saxena', 'Bhatt', 'Menon', 'Khan', 'Desai'];
  const companies = ['HSBC', 'Emirates NBD', 'Microsoft Gulf', 'Damac Group', 'DP World', 'Aramex', 'Etihad', 'Mashreq', 'Deloitte', 'PwC', 'McKinsey', 'AECOM', 'Apparel Group', 'Lulu Group', 'Self-employed', 'Aster DM', 'TCS', 'Infosys ME', null, null];
  const cities = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Mumbai', 'Delhi', 'Bangalore', 'London', 'Singapore'];
  const sources: LeadSource[] = [LeadSource.WHATSAPP, LeadSource.WEBSITE, LeadSource.EVENT, LeadSource.CSV_IMPORT, LeadSource.REFERRAL, LeadSource.INBOUND_CALL];
  const statuses = [LeadStatus.NEW, LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION, LeadStatus.BOOKING_DONE, LeadStatus.WON, LeadStatus.LOST];
  const callStatuses = ['Not reached yet', 'Reached today', 'Callback scheduled', 'Awaiting WhatsApp reply', 'Site visit confirmed', 'Documents pending', 'Booking form sent', 'Cooling off period'];
  const aiScores: AIScore[] = [AIScore.HOT, AIScore.HOT, AIScore.WARM, AIScore.WARM, AIScore.WARM, AIScore.COLD];
  const cfgs = ['Studio', '1BR', '2BR', '3BR', '4BR', 'PH', 'Villa'];
  const potentials: Potential[] = [Potential.HIGH, Potential.HIGH, Potential.MEDIUM, Potential.MEDIUM, Potential.LOW, Potential.UNKNOWN];
  const funds: FundReadiness[] = [FundReadiness.CASH_READY, FundReadiness.BANK_APPROVED, FundReadiness.FINANCING_NEEDED, FundReadiness.NOT_DISCUSSED];
  const moods: MoodStatus[] = [MoodStatus.EXCITED, MoodStatus.INTERESTED, MoodStatus.NEUTRAL, MoodStatus.HESITANT, MoodStatus.COLD, MoodStatus.CONFUSED];
  const timelines: InvestTimeline[] = [InvestTimeline.IMMEDIATE, InvestTimeline.THIRTY_DAYS, InvestTimeline.THREE_MONTHS, InvestTimeline.SIX_PLUS_MONTHS, InvestTimeline.WINDOW_SHOPPING, InvestTimeline.UNKNOWN];
  const categorizations = ['NRI Investor', 'NRI End-user', 'UAE Resident Investor', 'UAE Resident End-user', 'International Investor', 'First-time buyer'];
  const todos = ['Send AED brochure & payment plan', 'Schedule site visit Saturday', 'Confirm Q2 handover date with developer', 'Share Burj Khalifa view units only', 'Get spouse on a 3-way call', 'Resend mortgage pre-approval docs', 'Follow up after Eid', 'Negotiate with developer for 10% discount'];

  function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  const leads: any[] = [];
  for (let i = 0; i < 60; i++) {
    const fn = rand(firstNames), ln = rand(lastNames);
    const owner = rand(agents);
    const source = rand(sources);
    const status = rand(statuses);
    const aiScore = rand(aiScores);
    const scoreVal = aiScore === AIScore.HOT ? randInt(80, 96) : aiScore === AIScore.WARM ? randInt(50, 79) : randInt(15, 49);
    const city = rand(cities);
    const cfg = rand(cfgs);
    // City decides team + currency
    const isIndia = ['Mumbai','Delhi','Bangalore','Gurgaon','Hyderabad','Pune'].includes(city);
    const team = isIndia ? 'India' : 'Dubai';
    const currency = isIndia ? 'INR' : 'AED';
    // Realistic budgets per currency
    const budgetMin = isIndia
      ? randInt(50, 1500) * 100000    // ₹50 L – ₹15 Cr
      : randInt(5, 150) * 100000;     // AED 500K – AED 15M
    const ageMin = randInt(0, 60 * 24 * 14);
    const created = new Date(Date.now() - ageMin * 60 * 1000);
    const lastTouched = new Date(Date.now() - randInt(0, 60 * 24 * 5) * 60 * 1000);
    const followup = Math.random() < 0.7 ? new Date(Date.now() + randInt(-12, 72) * 3600 * 1000) : null;
    const meeting = Math.random() < 0.3 ? new Date(Date.now() + randInt(1, 14) * 86400 * 1000) : null;
    const siteVisit = Math.random() < 0.25 ? new Date(Date.now() + randInt(0, 10) * 86400 * 1000) : null;

    const lead = await prisma.lead.create({
      data: {
        name: `${fn} ${ln}`,
        phone: `+${rand(['971', '91'])} ${randInt(50, 99)} ${randInt(1000, 9999)} ${randInt(1000, 9999)}`,
        email: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/ /g,'')}@example.com`,
        company: rand(companies),
        city,
        country: ['Dubai','Abu Dhabi','Sharjah'].includes(city) ? 'UAE' : city === 'London' ? 'UK' : city === 'Singapore' ? 'Singapore' : 'India',
        address: `${randInt(10,999)} ${rand(['Marina Walk','Jumeirah Beach Rd','Sheikh Zayed Rd','JLT Cluster','BKC','Bandra W'])}`,
        source,
        sourceDetail: source === LeadSource.EVENT ? 'Dubai Property Expo 2026' : source === LeadSource.WHATSAPP ? 'marina-may-26' : undefined,
        status,
        currentStatus: rand(callStatuses),
        budgetMin,
        budgetMax: budgetMin * 1.25,
        budgetCurrency: currency,
        configuration: cfg,
        categorization: rand(categorizations),
        tags: rand(['NRI', 'Investor', 'End-user', 'HNI', 'Golden Visa']),
        // DEPTH FIELDS
        whoIsClient: rand(depthNarratives),
        whenCanInvest: rand(timelines),
        potential: rand(potentials),
        fundReadiness: rand(funds),
        moodStatus: rand(moods),
        detailShared: rand(['Brochure v3 + floor plans', 'Payment plan PDF + RERA escrow note', 'Virtual walkthrough link', 'Comparison: Marina Bay vs Sobha Hartland', 'Service charges sheet (annual)', '']),
        remarks: rand(['Wife is the decision maker; need her on call', 'Wants high-floor only; allergic to lower floors due to noise', 'Compared 4 properties — chose ours; needs final price match', 'Spouse traveling; revisit after the 15th', 'Mentioned a referral fee for his cousin', 'Asked about post-handover rental management services']),
        todoNext: rand(todos),
        followupDate: followup,
        meetingDate: meeting,
        siteVisitDate: siteVisit,
        // AI
        aiScore,
        aiScoreValue: scoreVal,
        aiSummary: aiScore === AIScore.HOT ? `High-intent ${city} buyer · ${cfg} · ${currency === 'INR' ? '₹'+(budgetMin/1e7).toFixed(1)+' Cr' : 'AED '+(budgetMin/1e6).toFixed(1)+'M'} budget · 60-80% booking probability within 14 days.` : aiScore === AIScore.WARM ? `Moderate interest; needs nurturing. Budget aligns with mid-tier inventory.` : `Low engagement; nurture or de-prioritize.`,
        aiNextAction: aiScore === AIScore.HOT ? 'Book a site visit this week and send the latest brochure.' : 'Send a personalised WhatsApp follow-up.',
        aiUpdatedAt: new Date(),
        ownerId: owner.id,
        forwardedTeam: team,
        lastTouchedAt: lastTouched,
        createdAt: created,
      },
    });
    leads.push(lead);

    await prisma.assignment.create({ data: { leadId: lead.id, userId: owner.id, reason: 'round-robin', assignedAt: created } });
    await prisma.activity.create({ data: { leadId: lead.id, userId: owner.id, type: ActivityType.LEAD_CREATED, status: ActivityStatus.DONE, title: `Lead created from ${source}`, description: lead.notesShort ?? undefined, completedAt: created, createdAt: created } });
    if (status !== LeadStatus.NEW) {
      await prisma.activity.create({ data: { leadId: lead.id, userId: owner.id, type: ActivityType.CALL, status: ActivityStatus.DONE, title: 'First call', completedAt: lastTouched, createdAt: lastTouched } });
      await prisma.callLog.create({ data: { leadId: lead.id, userId: owner.id, direction: CallDirection.OUTBOUND, phoneNumber: lead.phone!, durationSec: randInt(30, 480), outcome: CallOutcome.CONNECTED, startedAt: lastTouched } });
    }
    if (followup) {
      await prisma.activity.create({ data: { leadId: lead.id, userId: owner.id, type: ActivityType.CALL, status: ActivityStatus.PLANNED, title: lead.todoNext ?? 'Follow-up', scheduledAt: followup } });
    }
    if (Math.random() < 0.5 && units.length) {
      const u = rand(units);
      try { await prisma.leadProperty.create({ data: { leadId: lead.id, unitId: u.id, type: 'PRIMARY' as any } }); } catch {}
    }
  }
  console.log(`✓ ${leads.length} leads with depth fields + activities`);

  // ---------- Intake keys ----------
  await prisma.intakeKey.deleteMany();
  await Promise.all([
    prisma.intakeKey.create({ data: { label: 'whitecollarrealty.com website', key: 'wcr_live_website_demo_abcd1234', source: LeadSource.WEBSITE } }),
    prisma.intakeKey.create({ data: { label: 'Meta WhatsApp Cloud API', key: 'wcr_live_wa_demo_efgh5678', source: LeadSource.WHATSAPP } }),
  ]);

  console.log('\n✅ Seed complete!');
  console.log('   Admin    → lalit@whitecollarrealty.com  / demo1234');
  console.log('   Manager  → nishu@whitecollarrealty.com  / demo1234  (Dubai team)');
  console.log('   Agent    → krish@whitecollarrealty.com  / demo1234  (Dubai team)');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
