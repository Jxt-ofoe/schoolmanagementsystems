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

async function testOneSchool() {
  // Find a school with 0 students
  const { data: schools } = await supabase.from('schools').select('id, name, code');
  let targetSchool = null;
  for (const s of schools) {
    const { count } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', s.id);
    if (count === 0) {
      targetSchool = s;
      break;
    }
  }

  if (!targetSchool) {
    console.log('No school with 0 students found.');
    return;
  }

  console.log(`Testing with school: ${targetSchool.name} (${targetSchool.code})`);

  // 1. Ensure 20 classes exist
  let { data: existingClasses } = await supabase.from('classes').select('id, name, section').eq('school_id', targetSchool.id);
  if (!existingClasses || existingClasses.length < 20) {
    console.log(`Creating standard classes for ${targetSchool.name}...`);
    const existingKeys = new Set((existingClasses || []).map(c => `${c.name.toLowerCase()}#${(c.section || '').toLowerCase()}`));
    const classesToInsert = standardClasses
      .filter(c => !existingKeys.has(`${c.name.toLowerCase()}#${(c.section || '').toLowerCase()}`))
      .map(c => ({
        school_id: targetSchool.id,
        name: c.name,
        section: c.section,
        level_order: c.level_order,
        is_active: true
      }));

    if (classesToInsert.length > 0) {
      const { data: inserted, error: clsErr } = await supabase.from('classes').insert(classesToInsert).select('id, name, section');
      if (clsErr) {
        console.error('Error inserting classes:', clsErr);
        return;
      }
      existingClasses = [...(existingClasses || []), ...inserted];
    }
  }

  console.log(`School has ${existingClasses.length} classes available.`);

  // 2. Generate 1,000 students
  const prefix = (targetSchool.code || 'SCH').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'SCH';
  const students = [];
  const baseEpoch = new Date('2010-01-01').getTime();

  for (let i = 0; i < 1000; i++) {
    const isMale = i % 2 === 0;
    const fName = isMale ? maleFirstNames[(i * 7) % maleFirstNames.length] : femaleFirstNames[(i * 11) % femaleFirstNames.length];
    const lName = lastNames[(i * 13) % lastNames.length];
    const assignedClass = existingClasses[i % existingClasses.length];
    
    // Distinct DOB for each student
    const dob = new Date(baseEpoch + i * 2.8 * 86400000).toISOString().split('T')[0];
    const admissionNo = `${prefix}/ADM${String(i + 1).padStart(4, '0')}`;
    const gPhone = `024${String(1000000 + ((i * 313) % 9000000))}`;

    students.push({
      school_id: targetSchool.id,
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

  console.log('Inserting 1000 students in 2 batches of 500...');
  const t0 = Date.now();
  const { error: b1Err } = await supabase.from('students').insert(students.slice(0, 500));
  if (b1Err) {
    console.error('Batch 1 error:', b1Err);
    return;
  }
  const { error: b2Err } = await supabase.from('students').insert(students.slice(500, 1000));
  if (b2Err) {
    console.error('Batch 2 error:', b2Err);
    return;
  }
  const t1 = Date.now();
  console.log(`Success! 1,000 students added in ${t1 - t0}ms.`);

  // Verify count
  const { count: finalCount } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', targetSchool.id);
  console.log(`Verified total students in ${targetSchool.name}: ${finalCount}`);
}

testOneSchool();
