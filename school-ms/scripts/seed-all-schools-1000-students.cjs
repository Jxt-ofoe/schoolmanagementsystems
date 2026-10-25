const { createClient } = require('@supabase/supabase-js');

const fs = require('fs');
const path = require('path');
const envFile = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length && !process.env[k]) process.env[k] = v.join('=').trim();
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is not configured');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
  'Gideon', 'Theophilus', 'Dominic', 'Vincent', 'Felix', 'Prosper', 'Wisdom', 'Courage', 'Frank', 'Collins'
];

const femaleFirstNames = [
  'Ama', 'Akosua', 'Abena', 'Efua', 'Adwoa', 'Esi', 'Afua', 'Yaa', 'Aba', 'Dzifa',
  'Naa', 'Akua', 'Grace', 'Mercy', 'Peace', 'Patience', 'Faith', 'Blessing', 'Comfort', 'Gladys',
  'Doris', 'Beatrice', 'Esther', 'Mary', 'Martha', 'Ruth', 'Priscilla', 'Lydia', 'Hannah', 'Sarah',
  'Rebecca', 'Deborah', 'Emmanuella', 'Favour', 'Joyce', 'Evelyn', 'Vera', 'Gloria', 'Constance', 'Bernice',
  'Juliana', 'Theresa', 'Dorcas', 'Jennifer', 'Rita', 'Victoria', 'Abigail', 'Precious', 'Jessica', 'Sandra'
];

const lastNames = [
  'Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Osei', 'Addo', 'Agyeman', 'Darko', 'Quaye',
  'Tetteh', 'Ansah', 'Amoah', 'Bonsu', 'Frimpong', 'Lartey', 'Adjei', 'Nkansah', 'Kwarteng', 'Gyasi',
  'Boakye', 'Acheampong', 'Sarpong', 'Oppong', 'Agyei', 'Amponsah', 'Antwi', 'Baffoe', 'Badu', 'Danquah',
  'Gyan', 'Kyei', 'Marfo', 'Nyarko', 'Ofori', 'Otu', 'Prempeh', 'Sarfo', 'Yeboah', 'Agyemang',
  'Asamoah', 'Donkor', 'Fosu', 'Konadu', 'Twum', 'Wiredu', 'Amoako', 'Baah', 'Darkwa', 'Manu',
  'Agyapong', 'Anokye', 'Arthur', 'Essel', 'Forson', 'Hayford', 'Mills', 'Quansah', 'Sackey', 'Tagoe',
  'Lamptey', 'Nortey', 'Aryee', 'Oblitey', 'Klu', 'Dzokoto', 'Dotse', 'Gbeho', 'Agbenyega', 'Dogbe'
];

async function processSchool(school, index, totalSchools) {
  const startTime = Date.now();

  // 1. Get current student count
  const { count: currentCount } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', school.id);

  const needed = 1000 - (currentCount || 0);
  if (needed <= 0) {
    console.log(`[${index + 1}/${totalSchools}] ${school.name}: Already has ${currentCount} students. Skipping.`);
    return;
  }

  // 2. Ensure classes exist
  let { data: existingClasses } = await supabase
    .from('classes')
    .select('id, name, section')
    .eq('school_id', school.id);

  if (!existingClasses || existingClasses.length < 20) {
    const existingKeys = new Set(
      (existingClasses || []).map(c => `${c.name.toLowerCase()}#${(c.section || '').toLowerCase()}`)
    );
    const classesToInsert = standardClasses
      .filter(c => !existingKeys.has(`${c.name.toLowerCase()}#${(c.section || '').toLowerCase()}`))
      .map(c => ({
        school_id: school.id,
        name: c.name,
        section: c.section,
        level_order: c.level_order,
        is_active: true,
      }));

    if (classesToInsert.length > 0) {
      const { data: inserted, error: clsErr } = await supabase
        .from('classes')
        .insert(classesToInsert)
        .select('id, name, section');

      if (clsErr) {
        console.error(`[${index + 1}/${totalSchools}] Error creating classes for ${school.name}:`, clsErr.message);
      } else if (inserted) {
        existingClasses = [...(existingClasses || []), ...inserted];
      }
    }
  }

  if (!existingClasses || existingClasses.length === 0) {
    console.error(`[${index + 1}/${totalSchools}] ${school.name}: No classes available. Skipping students.`);
    return;
  }

  // 3. Generate student records
  const prefix = (school.code || 'SCH').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'SCH';
  const students = [];
  const baseEpoch = new Date('2010-01-01').getTime();
  const startOffset = currentCount || 0;

  for (let i = 0; i < needed; i++) {
    const overallIdx = startOffset + i;
    const isMale = overallIdx % 2 === 0;
    const fName = isMale
      ? maleFirstNames[(overallIdx * 7) % maleFirstNames.length]
      : femaleFirstNames[(overallIdx * 11) % femaleFirstNames.length];
    const lName = lastNames[(overallIdx * 13) % lastNames.length];
    const assignedClass = existingClasses[overallIdx % existingClasses.length];

    // Unique DOB per student in school
    const dob = new Date(baseEpoch + (overallIdx * 2.8) * 86400000).toISOString().split('T')[0];
    const admissionNo = `${prefix}/ADM${String(overallIdx + 1).padStart(4, '0')}`;
    const gPhone = `024${String(1000000 + ((overallIdx * 313) % 9000000))}`;

    students.push({
      school_id: school.id,
      admission_number: admissionNo,
      first_name: fName,
      last_name: lName,
      gender: isMale ? 'male' : 'female',
      date_of_birth: dob,
      current_class_id: assignedClass.id,
      enrollment_status: 'active',
      admission_date: '2026-09-01',
      guardian_name: `${isMale ? 'Mr.' : 'Mrs.'} ${lName}`,
      guardian_relationship: isMale ? 'Father' : 'Mother',
      guardian_phone: gPhone,
    });
  }

  // 4. Insert in batches of 500
  const BATCH_SIZE = 500;
  for (let b = 0; b < students.length; b += BATCH_SIZE) {
    const chunk = students.slice(b, b + BATCH_SIZE);
    const { error: insErr } = await supabase.from('students').insert(chunk);
    if (insErr) {
      console.error(`[${index + 1}/${totalSchools}] Batch insert error for ${school.name}:`, insErr.message);
      return;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${index + 1}/${totalSchools}] ${school.name} (${school.code}): +${needed} students -> Total 1,000 (${duration}s)`);
}

async function run() {
  console.log('=== Starting 1,000 Students Seeder for All Schools ===');
  const { data: schools, error: sErr } = await supabase
    .from('schools')
    .select('id, name, code')
    .order('name');

  if (sErr) {
    console.error('Error fetching schools:', sErr);
    return;
  }

  console.log(`Found ${schools.length} schools to process.`);

  // Process with concurrency = 4
  const CONCURRENCY = 4;
  for (let i = 0; i < schools.length; i += CONCURRENCY) {
    const slice = schools.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map((school, sIdx) => processSchool(school, i + sIdx, schools.length)));
  }

  // Final summary
  const { count: finalStudentCount } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true });

  const { count: finalClassCount } = await supabase
    .from('classes')
    .select('*', { count: 'exact', head: true });

  console.log('=== Seeding Complete ===');
  console.log(`Total Students across platform: ${finalStudentCount}`);
  console.log(`Total Classes across platform: ${finalClassCount}`);
}

run();
