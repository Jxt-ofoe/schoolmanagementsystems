const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Standard Ghana Curriculum Subjects (12 Subjects)
const standardSubjects = [
  { name: 'English Language', code: 'ENG' },
  { name: 'Mathematics', code: 'MATH' },
  { name: 'Integrated Science', code: 'SCI' },
  { name: 'Social Studies', code: 'SOC' },
  { name: 'Information and Communication Technology', code: 'ICT' },
  { name: 'Religious and Moral Education', code: 'RME' },
  { name: 'Basic Design and Technology', code: 'BDT' },
  { name: 'French', code: 'FRE' },
  { name: 'Ghanaian Language', code: 'GHA' },
  { name: 'Creative Arts', code: 'ART' },
  { name: 'Physical Education', code: 'PE' },
  { name: 'History', code: 'HIST' },
];

// 20 Standard Classes across Primary & JHS / SHS
const standardClasses = [
  { name: 'Basic 1', section: 'A', level_order: 1 },
  { name: 'Basic 1', section: 'B', level_order: 1 },
  { name: 'Basic 2', section: 'A', level_order: 2 },
  { name: 'Basic 2', section: 'B', level_order: 2 },
  { name: 'Basic 3', section: 'A', level_order: 3 },
  { name: 'Basic 3', section: 'B', level_order: 3 },
  { name: 'Basic 4', section: 'A', level_order: 4 },
  { name: 'Basic 4', section: 'B', level_order: 4 },
  { name: 'Basic 5', section: 'A', level_order: 5 },
  { name: 'Basic 5', section: 'B', level_order: 5 },
  { name: 'Basic 6', section: 'A', level_order: 6 },
  { name: 'Basic 6', section: 'B', level_order: 6 },
  { name: 'JHS 1', section: 'A', level_order: 7 },
  { name: 'JHS 1', section: 'B', level_order: 7 },
  { name: 'JHS 2', section: 'A', level_order: 8 },
  { name: 'JHS 2', section: 'B', level_order: 8 },
  { name: 'JHS 3', section: 'A', level_order: 9 },
  { name: 'JHS 3', section: 'B', level_order: 9 },
  { name: 'SHS 1', section: 'A', level_order: 10 },
  { name: 'SHS 1', section: 'B', level_order: 10 },
];

const maleFirstNames = [
  'Kwame', 'Kofi', 'Yaw', 'Kojo', 'Kwabena', 'Kwaku', 'Fiifi', 'Kwesi', 'Selorm', 'Mawuli',
  'Nii', 'Elikem', 'Emmanuel', 'Samuel', 'Michael', 'Daniel', 'Joseph', 'David', 'Isaac', 'Benjamin',
  'John', 'Peter', 'Paul', 'Francis', 'George', 'Prince', 'Bright', 'Godwin', 'Kafui', 'Dela',
  'Joshua', 'Ebenezer', 'Caleb', 'Kelvin', 'Dennis', 'Charles', 'Richard', 'Bernard', 'Patrick', 'Stephen',
  'Gideon', 'Theophilus', 'Dominic', 'Vincent', 'Felix', 'Prosper', 'Wisdom', 'Courage', 'Frank', 'Collins',
  'Albert', 'Alexander', 'Andrew', 'Anthony', 'Christian', 'Edward', 'Eric', 'Evans', 'Frederick', 'Henry',
  'James', 'Kenneth', 'Lawrence', 'Leonard', 'Martin', 'Matthew', 'Nathaniel', 'Nicholas', 'Philip', 'Raymond',
  'Robert', 'Solomon', 'Timothy', 'Victor', 'William', 'Richmond', 'Desmond', 'Kingsley', 'Justice', 'Freeman'
];

const femaleFirstNames = [
  'Ama', 'Akosua', 'Abena', 'Efua', 'Adwoa', 'Esi', 'Afua', 'Yaa', 'Aba', 'Dzifa',
  'Naa', 'Akua', 'Grace', 'Mercy', 'Peace', 'Patience', 'Faith', 'Blessing', 'Comfort', 'Gladys',
  'Doris', 'Beatrice', 'Esther', 'Mary', 'Martha', 'Ruth', 'Priscilla', 'Lydia', 'Hannah', 'Sarah',
  'Rebecca', 'Deborah', 'Emmanuella', 'Favour', 'Joyce', 'Evelyn', 'Vera', 'Gloria', 'Constance', 'Bernice',
  'Juliana', 'Theresa', 'Dorcas', 'Jennifer', 'Rita', 'Victoria', 'Abigail', 'Precious', 'Jessica', 'Sandra',
  'Agnes', 'Alice', 'Angela', 'Anita', 'Ann', 'Augustina', 'Belinda', 'Bridget', 'Catherine', 'Cecilia',
  'Charity', 'Christiana', 'Cynthia', 'Diana', 'Elizabeth', 'Florence', 'Francisca', 'Gertrude', 'Helen', 'Irene',
  'Janet', 'Josephine', 'Judith', 'Lucy', 'Margaret', 'Patricia', 'Paulina', 'Rose', 'Stella', 'Vivian'
];

const lastNames = [
  'Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Osei', 'Addo', 'Agyeman', 'Darko', 'Quaye',
  'Tetteh', 'Ansah', 'Amoah', 'Bonsu', 'Frimpong', 'Lartey', 'Adjei', 'Nkansah', 'Kwarteng', 'Gyasi',
  'Boakye', 'Acheampong', 'Sarpong', 'Oppong', 'Agyei', 'Amponsah', 'Antwi', 'Baffoe', 'Badu', 'Danquah',
  'Gyan', 'Kyei', 'Marfo', 'Nyarko', 'Ofori', 'Otu', 'Prempeh', 'Sarfo', 'Yeboah', 'Agyemang',
  'Asamoah', 'Donkor', 'Fosu', 'Konadu', 'Twum', 'Wiredu', 'Amoako', 'Baah', 'Darkwa', 'Manu',
  'Agyapong', 'Anokye', 'Arthur', 'Essel', 'Forson', 'Hayford', 'Mills', 'Quansah', 'Sackey', 'Tagoe',
  'Lamptey', 'Nortey', 'Aryee', 'Oblitey', 'Klu', 'Dzokoto', 'Dotse', 'Gbeho', 'Agbenyega', 'Dogbe',
  'Asare', 'Fordjour', 'Kusi', 'Nyame', 'Atta', 'Bediako', 'Amankwah', 'Adu', 'Agyiri', 'Boadu',
  'Cudjoe', 'Dadzie', 'Eshun', 'Ghartey', 'Inkoom', 'Koomson', 'Nuamah', 'Ocran', 'Prah', 'Turkson'
];

const schoolDefinitions = [
  { name: 'Achimota Model Academy', code: 'achimota-model', region: 'Greater Accra', city: 'Accra' },
  { name: 'Prempeh Memorial Basic School', code: 'prempeh-memorial', region: 'Ashanti', city: 'Kumasi' },
  { name: 'Wesley Girls Model School', code: 'wesley-girls-model', region: 'Central', city: 'Cape Coast' },
  { name: 'Mfantsipim Heritage Academy', code: 'mfantsipim-heritage', region: 'Central', city: 'Cape Coast' },
  { name: 'Presbyterian Boys Complex', code: 'presby-boys-complex', region: 'Greater Accra', city: 'Legon' },
  { name: 'Holy Child Modern School', code: 'holy-child-modern', region: 'Central', city: 'Cape Coast' },
  { name: 'Adisadel College Basic', code: 'adisadel-basic', region: 'Central', city: 'Cape Coast' },
  { name: 'Opoku Ware Heritage Academy', code: 'opoku-ware-heritage', region: 'Ashanti', city: 'Kumasi' },
  { name: 'St. Augustines Basic School', code: 'st-augustines-basic', region: 'Central', city: 'Cape Coast' },
  { name: 'Aburi Girls Academy', code: 'aburi-girls-academy', region: 'Eastern', city: 'Aburi' },
  { name: 'Mawuli Pioneer School', code: 'mawuli-pioneer', region: 'Volta', city: 'Ho' },
  { name: 'Keta Senior Model School', code: 'keta-model-school', region: 'Volta', city: 'Keta' },
  { name: 'Tamale International Academy', code: 'tamale-intl-academy', region: 'Northern', city: 'Tamale' },
  { name: 'Sunyani Crown Academy', code: 'sunyani-crown-academy', region: 'Bono', city: 'Sunyani' },
  { name: 'St. Peters Basic School', code: 'st-peters-basic', region: 'Eastern', city: 'Nkwatia' },
  { name: 'Accra Academy Model School', code: 'accra-academy-model', region: 'Greater Accra', city: 'Accra' },
  { name: 'Ghana National Academy', code: 'ghana-national-academy', region: 'Central', city: 'Cape Coast' },
  { name: 'Pope John Modern Academy', code: 'pope-john-modern', region: 'Eastern', city: 'Koforidua' },
  { name: 'St. Louis Heritage School', code: 'st-louis-heritage', region: 'Ashanti', city: 'Kumasi' },
  { name: 'Archbishop Porter Academy', code: 'archbishop-porter', region: 'Western', city: 'Takoradi' },
  { name: 'Yaa Asantewaa Memorial School', code: 'yaa-asantewaa-memorial', region: 'Ashanti', city: 'Kumasi' },
  { name: 'Osu Presby Model School', code: 'osu-presby-model', region: 'Greater Accra', city: 'Osu' },
  { name: 'Kumasi High Model Academy', code: 'kumasi-high-model', region: 'Ashanti', city: 'Kumasi' },
  { name: 'Winneba Heritage School', code: 'winneba-heritage', region: 'Central', city: 'Winneba' },
  { name: 'Cape Coast Model Academy', code: 'cape-coast-model', region: 'Central', city: 'Cape Coast' },
  { name: 'Koforidua Pioneer School', code: 'koforidua-pioneer', region: 'Eastern', city: 'Koforidua' },
  { name: 'Ho Technical Model Basic', code: 'ho-technical-model', region: 'Volta', city: 'Ho' },
  { name: 'Bolgatanga Crown Academy', code: 'bolgatanga-crown', region: 'Upper East', city: 'Bolgatanga' },
  { name: 'Wa Central Model School', code: 'wa-central-model', region: 'Upper West', city: 'Wa' },
  { name: 'Tema Community Basic School', code: 'tema-community-basic', region: 'Greater Accra', city: 'Tema' },
];

function generateSecurePassword() {
  return crypto.randomBytes(9).toString('base64url') + '9z';
}

function generateMarkdown() {
  let md = `# Multi-Tenant Load & Concurrency Stress Test Suite\n\n`;
  md += `## Overview\n\n`;
  md += `This stress test dataset provides **30 complete school environments**, each equipped with:\n\n`;
  md += `- **2,000 enrolled students** per school (**60,000 total students** across the platform)\n`;
  md += `- **24 assigned teachers** per school (**720 total teachers**)\n`;
  md += `- **1 headmaster** per school (**30 headmasters**)\n`;
  md += `- **20 active classes** per school (Basic 1A/B through JHS 3A/B & SHS 1A/B)\n`;
  md += `- **12 standard curriculum subjects** fully linked\n`;
  md += `- **260 teacher assignments per school** (20 homeroom class teachers + 240 subject teaching allocations covering every class and subject)\n`;
  md += `- **Active Term Billing Configurations** (GH₵ 3.00 / student / term with 30-day grace period)\n\n`;

  md += `### Universal Credentials Summary\n\n`;
  md += `| Role | Email Format | Universal Password | Permissions |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  md += `| **Headmaster** | \`headmaster@<school-code>.edu.gh\` | Per-account random password | Full school administration, teacher onboarding, class/subject management, billing & invoice payments, reports |\n`;
  md += `| **Teacher** | \`teacher<01-24>@<school-code>.edu.gh\` | Per-account random password | Attendance recording, score entry for assigned classes & subjects, class roster viewing |\n\n`;

  md += `## Directory of 30 Seeded Schools\n\n`;
  md += `| # | School Name | School Code | Region | Headmaster Login | Teachers | Students | Status |\n`;
  md += `| :-: | :--- | :--- | :--- | :--- | :-: | :-: | :-: |\n`;

  schoolDefinitions.forEach((s, idx) => {
    md += `| ${idx + 1} | **${s.name}** | \`${s.code}\` | ${s.region} | \`headmaster@${s.code}.edu.gh\` | 24 | 2,000 | Active |\n`;
  });

  md += `\n---\n\n## Complete Staff Account & Credential Directory\n\n`;

  schoolDefinitions.forEach((s, sIdx) => {
    const headName = `${maleFirstNames[(sIdx * 3) % maleFirstNames.length]} ${lastNames[(sIdx * 5) % lastNames.length]}`;
    const headEmail = `headmaster@${s.code}.edu.gh`;

    md += `### ${sIdx + 1}. ${s.name} (\`${s.code}\`)\n\n`;
    md += `**Location:** ${s.city}, ${s.region} Region  \n`;
    md += `**Headmaster:** ${headName} — Email: \`${headEmail}\` | Password: \`${generateSecurePassword()}\`  \n`;
    md += `**Students:** 2,000 | **Classes:** 20 | **Curriculum Subjects:** 12  \n\n`;

    md += `#### Teachers (24 Staff Members)\n\n`;
    md += `| ID | Teacher Name | Email | Password | Homeroom Class | Primary Subjects |\n`;
    md += `| :-: | :--- | :--- | :--- | :--- | :--- |\n`;

    for (let t = 1; t <= 24; t++) {
      const tNumStr = String(t).padStart(2, '0');
      const isMale = (t + sIdx) % 2 === 0;
      const fName = isMale ? maleFirstNames[(t * 7 + sIdx) % maleFirstNames.length] : femaleFirstNames[(t * 11 + sIdx) % femaleFirstNames.length];
      const lName = lastNames[(t * 13 + sIdx * 3) % lastNames.length];
      const tEmail = `teacher${tNumStr}@${s.code}.edu.gh`;
      const homeroom = t <= 20 ? `${standardClasses[t - 1].name} ${standardClasses[t - 1].section}` : 'Specialist Floater';
      const subj1 = standardSubjects[(t - 1) % standardSubjects.length].name;
      const subj2 = standardSubjects[(t + 4) % standardSubjects.length].name;

      md += `| T${tNumStr} | ${fName} ${lName} | \`${tEmail}\` | \`${generateSecurePassword()}\` | ${homeroom} | ${subj1}, ${subj2} |\n`;
    }

    md += `\n---\n\n`;
  });

  md += `## Concurrency & Stress Testing Guide\n\n`;
  md += `### Test Scenarios to Verify System Resilience\n\n`;
  md += `1. **Concurrent Staff Sign-In Spike (750 simulated users)**:\n`;
  md += `   - Use a script (or tools like k6 / Autocannon) to send concurrent login requests using the 750 credentials.\n`;
  md += `   - **Target**: Supabase Auth GoTrue endpoint handling JWT session issuance.\n\n`;
  md += `2. **Simultaneous Attendance Submission**:\n`;
  md += `   - Simulate 720 teachers simultaneously posting attendance sessions and student attendance records across 600 classes.\n`;
  md += `   - **Target**: High-volume write transactions and composite foreign key integrity on \`attendance_sessions\`.\n\n`;
  md += `3. **Mass Student Assessment & Grade Entry**:\n`;
  md += `   - Simulate teachers entering term scores (30% class score, 70% exam score) for 2,000 students per school.\n`;
  md += `   - **Target**: Postgres row locks, trigger executions (\`trigger_student_billing_topup\` vs normal evaluation).\n\n`;
  md += `4. **Multi-Tenant Invoice Query Load**:\n`;
  md += `   - 30 headmasters concurrently loading billing dashboards, viewing invoice history, and requesting invoices.\n`;
  md += `   - **Target**: Row-Level Security (RLS) tenant isolation speed with 60,000 student records.\n\n`;

  return md;
}

const localStackDir = path.resolve(__dirname, '../.local-stack');
if (!fs.existsSync(localStackDir)) {
  fs.mkdirSync(localStackDir, { recursive: true });
}
const credsPath = path.join(localStackDir, 'seed-credentials.txt');
const mdContent = generateMarkdown();
fs.writeFileSync(credsPath, mdContent, 'utf8');
console.log(`Successfully generated seed-credentials.txt in .local-stack/ at: ${credsPath}`);

