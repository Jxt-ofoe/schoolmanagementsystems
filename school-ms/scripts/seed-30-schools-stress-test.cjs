const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Load environment variables
const envFile = path.resolve(__dirname, '../.env.local');
const env = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) env[k] = v.join('=').trim();
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: Supabase URL and Service Role Key required.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

// Names datasets
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

// 30 Schools specification
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

const HEADMASTER_PASSWORD = 'SchoolHead2026!';
const TEACHER_PASSWORD = 'TeacherPass2026!';

// Global in-memory cache of auth users to prevent redundant createUser / listUsers calls
const existingUserCache = new Map();

// Retry wrapper with exponential backoff for resilient network calls
async function withRetry(fn, label = 'operation', maxRetries = 6) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fn();
      if (res && res.error) {
        throw new Error(res.error.message || JSON.stringify(res.error));
      }
      return res;
    } catch (err) {
      const msg = err?.message || String(err);
      if (attempt === maxRetries) {
        console.error(`[FATAL] ${label} failed after ${maxRetries} attempts: ${msg}`);
        throw err;
      }
      const delay = attempt * 1200;
      console.warn(`[WARN] ${label} attempt ${attempt} failed (${msg}). Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Helper: Concurrency worker with controlled batch size
async function mapConcurrent(items, concurrency, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Helper: Refresh auth users cache
async function refreshUserCache() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (!error && data?.users) {
    for (const u of data.users) {
      if (u.email) existingUserCache.set(u.email.toLowerCase(), u);
    }
  }
}

// Helper: Create or get auth user safely using memory cache
async function createOrGetAuthUser(email, password, fullName) {
  const normEmail = email.toLowerCase().trim();
  if (existingUserCache.has(normEmail)) {
    return existingUserCache.get(normEmail);
  }

  return withRetry(async () => {
    if (existingUserCache.has(normEmail)) {
      return existingUserCache.get(normEmail);
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: normEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (!error && data?.user) {
      existingUserCache.set(normEmail, data.user);
      return data.user;
    }

    if (error && (error.code === 'email_exists' || error.message?.includes('already registered') || error.message?.includes('already exists'))) {
      await refreshUserCache();
      if (existingUserCache.has(normEmail)) {
        return existingUserCache.get(normEmail);
      }
    }

    if (error) throw error;
    throw new Error('User creation returned empty payload');
  }, `createAuthUser(${normEmail})`);
}

async function main() {
  console.log('================================================================');
  console.log('STRESS TEST SEEDER: 30 SCHOOLS · 750 STAFF ACCOUNTS · 60,000 STUDENTS');
  console.log('================================================================\n');

  console.log('Initializing auth cache...');
  await refreshUserCache();
  console.log(`Loaded ${existingUserCache.size} existing auth accounts into cache.`);

  const credentialsLog = [];
  const startTime = Date.now();

  for (let sIdx = 0; sIdx < schoolDefinitions.length; sIdx++) {
    const sDef = schoolDefinitions[sIdx];
    const sNum = sIdx + 1;
    const schoolStart = Date.now();
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[${sNum}/30] Setting up School: ${sDef.name} (${sDef.code})`);
    console.log(`----------------------------------------------------------------`);

    // 1. Upsert School record
    const schoolRes = await withRetry(async () => {
      let { data: existing } = await supabase
        .from('schools')
        .select('id, name, code')
        .eq('code', sDef.code)
        .maybeSingle();

      if (existing) return existing;

      const { data: created, error } = await supabase
        .from('schools')
        .insert({
          name: sDef.name,
          code: sDef.code,
          status: 'active',
          region: sDef.region,
          address: `${sDef.city}, ${sDef.region} Region, Ghana`,
          email: `info@${sDef.code}.edu.gh`,
          phone: `030${String(2000000 + sIdx * 11111)}`,
          motto: 'Excellence in Leadership and Scholarship',
        })
        .select('id, name, code')
        .single();

      if (error) throw error;
      return created;
    }, `upsertSchool(${sDef.code})`);

    const schoolId = schoolRes.id;

    // 2. Billing Config (GHS 3.00 per student per term as requested)
    await withRetry(async () => {
      return supabase
        .from('school_billing_configs')
        .upsert({
          school_id: schoolId,
          pricing_model: 'per_student',
          price_per_student: 3.00,
          billing_frequency: 'semester',
          billing_start_date: '2026-09-01',
          due_days: 30,
          grace_period_days: 30,
          status: 'active',
        }, { onConflict: 'school_id' });
    }, `upsertBillingConfig(${sDef.code})`);

    // 3. Academic Year & Semester
    const acadYearId = await withRetry(async () => {
      let { data: ay } = await supabase
        .from('academic_years')
        .select('id')
        .eq('school_id', schoolId)
        .eq('name', '2026/2027')
        .maybeSingle();

      if (ay) return ay.id;

      const { data: newAY, error } = await supabase
        .from('academic_years')
        .insert({
          school_id: schoolId,
          name: '2026/2027',
          starts_on: '2026-09-01',
          ends_on: '2027-07-31',
          is_current: true,
        })
        .select('id')
        .single();
      if (error) throw error;
      return newAY.id;
    }, `upsertAcademicYear(${sDef.code})`);

    const semesterId = await withRetry(async () => {
      let { data: sem } = await supabase
        .from('semesters')
        .select('id')
        .eq('school_id', schoolId)
        .eq('academic_year_id', acadYearId)
        .eq('name', 'Term 1')
        .maybeSingle();

      if (sem) return sem.id;

      const { data: newSem, error } = await supabase
        .from('semesters')
        .insert({
          school_id: schoolId,
          academic_year_id: acadYearId,
          name: 'Term 1',
          starts_on: '2026-09-01',
          ends_on: '2026-12-15',
          registration_deadline: '2026-10-15',
          status: 'open',
          is_current: true,
        })
        .select('id')
        .single();
      if (error) throw error;
      return newSem.id;
    }, `upsertSemester(${sDef.code})`);

    // 4. Create Standard Subjects (12 subjects)
    const existingSubjects = await withRetry(async () => {
      let { data: subs } = await supabase
        .from('subjects')
        .select('id, name, code')
        .eq('school_id', schoolId);

      subs = subs || [];
      if (subs.length < standardSubjects.length) {
        const existingNames = new Set(subs.map(s => s.name.toLowerCase()));
        const toInsert = standardSubjects
          .filter(sub => !existingNames.has(sub.name.toLowerCase()))
          .map(sub => ({
            school_id: schoolId,
            name: sub.name,
            code: sub.code,
            is_active: true,
          }));

        if (toInsert.length > 0) {
          const { data: newSubs, error } = await supabase.from('subjects').insert(toInsert).select('id, name, code');
          if (error) throw error;
          subs = [...subs, ...(newSubs || [])];
        }
      }
      return subs;
    }, `ensureSubjects(${sDef.code})`);

    // 5. Create 20 Standard Classes
    const existingClasses = await withRetry(async () => {
      let { data: cls } = await supabase
        .from('classes')
        .select('id, name, section, level_order')
        .eq('school_id', schoolId)
        .order('level_order', { ascending: true });

      cls = cls || [];
      if (cls.length < standardClasses.length) {
        const existingKeys = new Set(cls.map(c => `${c.name.toLowerCase()}#${(c.section || '').toLowerCase()}`));
        const toInsert = standardClasses
          .filter(c => !existingKeys.has(`${c.name.toLowerCase()}#${(c.section || '').toLowerCase()}`))
          .map(c => ({
            school_id: schoolId,
            name: c.name,
            section: c.section,
            level_order: c.level_order,
            capacity: 120,
            is_active: true,
          }));

        if (toInsert.length > 0) {
          const { data: newCls, error } = await supabase.from('classes').insert(toInsert).select('id, name, section, level_order');
          if (error) throw error;
          cls = [...cls, ...(newCls || [])].sort((a, b) => a.level_order - b.level_order);
        }
      }
      return cls;
    }, `ensureClasses(${sDef.code})`);

    // 6. Create Staff Accounts (1 Headmaster + 24 Teachers = 25 staff)
    const staffToCreate = [];
    
    // Headmaster
    const headEmail = `headmaster@${sDef.code}.edu.gh`;
    const headName = `${maleFirstNames[(sIdx * 3) % maleFirstNames.length]} ${lastNames[(sIdx * 5) % lastNames.length]}`;
    staffToCreate.push({
      email: headEmail,
      password: HEADMASTER_PASSWORD,
      fullName: headName,
      role: 'headmaster',
    });

    // 24 Teachers
    for (let t = 1; t <= 24; t++) {
      const tNumStr = String(t).padStart(2, '0');
      const isMale = (t + sIdx) % 2 === 0;
      const fName = isMale ? maleFirstNames[(t * 7 + sIdx) % maleFirstNames.length] : femaleFirstNames[(t * 11 + sIdx) % femaleFirstNames.length];
      const lName = lastNames[(t * 13 + sIdx * 3) % lastNames.length];
      const tEmail = `teacher${tNumStr}@${sDef.code}.edu.gh`;
      staffToCreate.push({
        email: tEmail,
        password: TEACHER_PASSWORD,
        fullName: `${fName} ${lName}`,
        role: 'teacher',
        teacherIdx: t - 1,
      });
    }

    console.log(` Ensuring 25 staff auth accounts for ${sDef.name}...`);
    const createdStaff = await mapConcurrent(staffToCreate, 3, async (staff) => {
      const user = await createOrGetAuthUser(staff.email, staff.password, staff.fullName);
      
      // Upsert Profile
      await withRetry(async () => {
        return supabase.from('profiles').upsert({
          id: user.id,
          email: staff.email,
          full_name: staff.fullName,
        }, { onConflict: 'id' });
      }, `upsertProfile(${staff.email})`);

      // Upsert School Membership
      await withRetry(async () => {
        return supabase.from('school_memberships').upsert({
          school_id: schoolId,
          user_id: user.id,
          role: staff.role,
          status: 'active',
        }, { onConflict: 'school_id,user_id' });
      }, `upsertMembership(${staff.email})`);

      // Record credentials for export
      credentialsLog.push({
        schoolName: sDef.name,
        schoolCode: sDef.code,
        role: staff.role,
        name: staff.fullName,
        email: staff.email,
        password: staff.password,
      });

      return { ...staff, userId: user.id };
    });

    const teacherStaff = createdStaff.filter(s => s.role === 'teacher');

    // 7. Teacher Assignments
    // Homeroom assignments: First 20 teachers assigned to the 20 classes (subject_id = null)
    const assignmentsToInsert = [];
    for (let c = 0; c < Math.min(existingClasses.length, 20); c++) {
      assignmentsToInsert.push({
        school_id: schoolId,
        teacher_id: teacherStaff[c].userId,
        class_id: existingClasses[c].id,
        subject_id: null, // Homeroom class teacher
      });
    }

    // Subject assignments: All 20 classes * 12 subjects = 240 combinations distributed evenly among 24 teachers
    let comboCount = 0;
    for (let c = 0; c < existingClasses.length; c++) {
      for (let s = 0; s < existingSubjects.length; s++) {
        const assignedTeacher = teacherStaff[comboCount % teacherStaff.length];
        comboCount++;
        assignmentsToInsert.push({
          school_id: schoolId,
          teacher_id: assignedTeacher.userId,
          class_id: existingClasses[c].id,
          subject_id: existingSubjects[s].id,
        });
      }
    }

    await withRetry(async () => {
      await supabase.from('teacher_assignments').delete().eq('school_id', schoolId);
      for (let i = 0; i < assignmentsToInsert.length; i += 100) {
        const { error } = await supabase.from('teacher_assignments').insert(assignmentsToInsert.slice(i, i + 100));
        if (error) throw error;
      }
      return true;
    }, `insertTeacherAssignments(${sDef.code})`);

    console.log(` Configured ${assignmentsToInsert.length} teacher assignments (20 class teachers + 240 subject teaching allocations).`);

    // 8. Generate & Insert 2,000 Students
    const studentCountRes = await withRetry(async () => {
      return supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', schoolId);
    }, `countStudents(${sDef.code})`);

    const existingStudentCount = studentCountRes.count || 0;
    const neededStudents = Math.max(0, 2000 - existingStudentCount);

    if (neededStudents === 0) {
      console.log(` School already has ${existingStudentCount} students. Skipping student insert.`);
    } else {
      console.log(` Inserting ${neededStudents} students (current: ${existingStudentCount}/2000)...`);
      const codePrefix = sDef.code.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
      const studentsToInsert = [];
      const startIndex = existingStudentCount;

      for (let i = 0; i < neededStudents; i++) {
        const globalIdx = startIndex + i;
        const isMale = (globalIdx + sIdx) % 2 === 0;
        const fName = isMale ? maleFirstNames[(globalIdx * 3 + sIdx * 7) % maleFirstNames.length] : femaleFirstNames[(globalIdx * 5 + sIdx * 11) % femaleFirstNames.length];
        const lName = lastNames[(globalIdx * 7 + sIdx * 13) % lastNames.length];
        const classObj = existingClasses[Math.floor(globalIdx / 100) % existingClasses.length];

        // Guarantee unique DOB per name combination in school:
        const day = (globalIdx % 28) + 1;
        const month = ((Math.floor(globalIdx / 28)) % 12) + 1;
        const year = 2008 + (Math.floor(globalIdx / 336) % 10);
        const dob = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const admNum = `${codePrefix}/2026/${String(globalIdx + 1).padStart(4, '0')}`;
        const gPhone = `024${String(1000000 + ((globalIdx * 491 + sIdx * 73) % 8999999))}`;

        studentsToInsert.push({
          school_id: schoolId,
          admission_number: admNum,
          first_name: fName,
          last_name: lName,
          gender: isMale ? 'male' : 'female',
          date_of_birth: dob,
          current_class_id: classObj.id,
          enrollment_status: 'active',
          admission_date: '2026-09-01',
          guardian_name: `${isMale ? 'Mr.' : 'Mrs.'} ${lName}`,
          guardian_relationship: isMale ? 'Father' : 'Mother',
          guardian_phone: gPhone,
        });
      }

      // Insert students in chunks of 500 with retry
      let insertedStudentRecords = [];
      for (let b = 0; b < studentsToInsert.length; b += 500) {
        const chunk = studentsToInsert.slice(b, b + 500);
        const chunkBatchNum = Math.floor(b / 500) + 1;
        const totalBatches = Math.ceil(studentsToInsert.length / 500);

        const insertedChunk = await withRetry(async () => {
          const { data, error } = await supabase
            .from('students')
            .insert(chunk)
            .select('id, current_class_id');
          if (error) throw error;
          return data;
        }, `insertStudentsBatch(${sDef.code}, batch ${chunkBatchNum}/${totalBatches})`);

        insertedStudentRecords.push(...(insertedChunk || []));
      }

      console.log(` Successfully inserted ${insertedStudentRecords.length} students into public.students.`);

      // 9. Enroll Students for current Semester
      if (semesterId && insertedStudentRecords.length > 0) {
        const enrollments = insertedStudentRecords.map(st => ({
          school_id: schoolId,
          student_id: st.id,
          semester_id: semesterId,
          class_id: st.current_class_id,
          status: 'registered',
          is_late: false,
        }));

        for (let b = 0; b < enrollments.length; b += 500) {
          const chunk = enrollments.slice(b, b + 500);
          await withRetry(async () => {
            const { error } = await supabase
              .from('student_enrollments')
              .insert(chunk);
            if (error && !error.message.includes('duplicate key')) throw error;
            return true;
          }, `insertEnrollmentsBatch(${sDef.code})`);
        }
        console.log(` Enrolled ${enrollments.length} students into current semester (Term 1).`);
      }
    }

    const schoolDuration = ((Date.now() - schoolStart) / 1000).toFixed(1);
    console.log(` [${sNum}/30] ${sDef.name} verified and ready in ${schoolDuration}s.`);
  }

  // 10. Write Credentials to CSV
  const csvPath = path.resolve(__dirname, 'credentials_export.csv');
  let csvContent = 'School Name,School Code,Role,Full Name,Email,Password\n';
  for (const c of credentialsLog) {
    csvContent += `"${c.schoolName}","${c.schoolCode}","${c.role}","${c.name}","${c.email}","${c.password}"\n`;
  }
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`\nExported all ${credentialsLog.length} staff credentials to: ${csvPath}`);

  const totalMinutes = ((Date.now() - startTime) / 60000).toFixed(2);
  console.log('\n================================================================');
  console.log(`ALL 30 SCHOOLS SEEDED SUCCESSFULLY IN ${totalMinutes} MINUTES!`);
  console.log(`Total staff credentials logged: ${credentialsLog.length}`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('Fatal Seeder Error:', err);
  process.exit(1);
});
