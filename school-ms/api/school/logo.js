import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';

const ALLOWED_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
};

export async function handleSchoolLogo(body, authHeader) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY environment variable is not configured');
  }

  const { school_id, file, content_type, remove } = body;
  if (!school_id) {
    throw new Error('School ID is required');
  }

  // 1. Verify caller is authorized
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Unauthorized: please sign in again');
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new Error('Unauthorized: invalid session');
  }
  const callerId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller is super_admin or headmaster of this school
  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;

  const { data: school } = await adminClient.from('schools').select('id, name, status').eq('id', school_id).maybeSingle();
  if (!school) {
    throw new Error('School not found');
  }

  if (!isSuperAdmin) {
    const { data: m } = await adminClient
      .from('school_memberships')
      .select('role, status')
      .eq('school_id', school_id)
      .eq('user_id', callerId)
      .maybeSingle();

    if (!m || m.role !== 'headmaster' || m.status !== 'active') {
      throw new Error('Unauthorized: only the headmaster can manage this school’s logo');
    }
  }

  // 2. Action: Remove logo
  if (remove) {
    try {
      // Find and delete any existing files in this school's logo folder
      const { data: existingFiles } = await adminClient.storage.from('school-logos').list(school_id);
      if (existingFiles && existingFiles.length > 0) {
        const pathsToDelete = existingFiles.map((f) => `${school_id}/${f.name}`);
        await adminClient.storage.from('school-logos').remove(pathsToDelete);
      }
    } catch (cleanErr) {
      console.warn('Notice cleaning old logos:', cleanErr.message);
    }

    // Try to update database column if it exists
    try {
      await adminClient.from('schools').update({ logo_url: null }).eq('id', school_id);
    } catch (dbErr) {
      console.warn('Note: logo_url column might not exist yet:', dbErr.message);
    }

    // Audit log
    try {
      await adminClient.from('audit_logs').insert({
        school_id,
        actor_id: callerId,
        actor_role: isSuperAdmin ? 'super_admin' : 'headmaster',
        action: 'school.logo_removed',
        entity_type: 'school',
        entity_id: school_id,
        metadata: { school_name: school.name },
      });
    } catch {
      // Non-critical audit failure
    }

    return { success: true, url: null };
  }

  // 3. Action: Upload logo
  if (!file) {
    throw new Error('No logo image data provided');
  }

  // Extract base64 payload
  let base64Data = file;
  let detectedType = content_type;

  if (file.startsWith('data:')) {
    const matches = file.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      detectedType = matches[1];
      base64Data = matches[2];
    }
  }

  const mime = (detectedType || 'image/png').toLowerCase();
  const ext = ALLOWED_MIME_TYPES[mime];
  if (!ext) {
    throw new Error('Unsupported image format. Please upload a PNG, JPG, WebP, or SVG file.');
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const MAX_SIZE = 3 * 1024 * 1024; // 3MB
  if (buffer.length > MAX_SIZE) {
    throw new Error('Image file is too large. Please upload an image under 3MB.');
  }

  // File path with cache-busting timestamp
  const fileName = `logo-${Date.now()}.${ext}`;
  const filePath = `${school_id}/${fileName}`;

  // Upload to Supabase Storage
  const { error: uploadErr } = await adminClient.storage
    .from('school-logos')
    .upload(filePath, buffer, {
      contentType: mime,
      upsert: true,
    });

  if (uploadErr) {
    console.error('Storage upload error:', uploadErr);
    throw new Error(`Failed to upload logo: ${uploadErr.message}`);
  }

  // Generate public URL
  const { data: pubData } = adminClient.storage.from('school-logos').getPublicUrl(filePath);
  const publicUrl = pubData.publicUrl;

  // Clean up previous logos for this school so only the latest remains
  try {
    const { data: oldFiles } = await adminClient.storage.from('school-logos').list(school_id);
    if (oldFiles && oldFiles.length > 0) {
      const filesToRemove = oldFiles
        .filter((f) => f.name !== fileName)
        .map((f) => `${school_id}/${f.name}`);
      if (filesToRemove.length > 0) {
        await adminClient.storage.from('school-logos').remove(filesToRemove);
      }
    }
  } catch (cleanErr) {
    console.warn('Notice cleaning previous logos:', cleanErr.message);
  }

  // Try updating the database column if present
  try {
    const { error: dbErr } = await adminClient.from('schools').update({ logo_url: publicUrl }).eq('id', school_id);
    if (dbErr) {
      console.warn('Note: schools.logo_url column update notice:', dbErr.message);
    }
  } catch (dbErr) {
    console.warn('Note: schools.logo_url column update exception:', dbErr.message);
  }

  // Audit log
  try {
    await adminClient.from('audit_logs').insert({
      school_id,
      actor_id: callerId,
      actor_role: isSuperAdmin ? 'super_admin' : 'headmaster',
      action: 'school.logo_updated',
      entity_type: 'school',
      entity_id: school_id,
      metadata: { school_name: school.name, logo_url: publicUrl },
    });
  } catch {
    // Non-critical audit failure
  }

  return { success: true, url: publicUrl };
}

export async function handleGetSchoolLogo(schoolId) {
  if (!schoolId) return { url: null };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { url: null };

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: files, error } = await adminClient.storage.from('school-logos').list(schoolId);
    if (error || !files || files.length === 0) return { url: null };

    // Get the latest logo file
    const latest = files
      .filter((f) => f.name && !f.name.startsWith('.'))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];

    if (!latest) return { url: null };

    const { data: pubData } = adminClient.storage.from('school-logos').getPublicUrl(`${schoolId}/${latest.name}`);
    return { url: pubData.publicUrl };
  } catch {
    return { url: null };
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const schoolId = url.searchParams.get('school_id');
      const result = await handleGetSchoolLogo(schoolId);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: err.message || 'Failed to get school logo' }));
    }
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', async () => {
    try {
      const data = typeof body === 'string' && body ? JSON.parse(body) : req.body || {};
      const authHeader = req.headers['authorization'];
      const result = await handleSchoolLogo(data, authHeader);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'Failed to update school logo' }));
    }
  });
}
