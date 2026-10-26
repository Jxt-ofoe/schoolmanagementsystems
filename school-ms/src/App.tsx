import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequireRole, RoleHome, NotFound } from './components/guards';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/auth/Login';
import { ForgotPasswordPage } from './pages/auth/ForgotPassword';
import { SetPasswordPage } from './pages/auth/SetPassword';

const AccountPage = lazy(() => import('./pages/auth/Account'));
// platform
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminSchools = lazy(() => import('./pages/admin/Schools'));
const AdminSchoolDetail = lazy(() => import('./pages/admin/SchoolDetail'));
const AdminBilling = lazy(() => import('./pages/admin/Billing'));
const AdminRenewals = lazy(() => import('./pages/admin/Renewals'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AuditPage = lazy(() => import('./pages/shared/Audit'));
// headmaster
const SchoolDashboard = lazy(() => import('./pages/school/Dashboard'));
const StudentsPage = lazy(() => import('./pages/school/Students'));
const ClassStudentsPage = lazy(() => import('./pages/school/ClassStudents'));
const StudentProfilePage = lazy(() => import('./pages/school/StudentProfile'));
const ClassesPage = lazy(() => import('./pages/school/Classes'));
const SubjectsPage = lazy(() => import('./pages/school/Subjects'));
const TeachersPage = lazy(() => import('./pages/school/Teachers'));
const AcademicPage = lazy(() => import('./pages/school/Academic'));
const AttendanceOverviewPage = lazy(() => import('./pages/school/AttendanceOverview'));
const GradesOverviewPage = lazy(() => import('./pages/school/GradesOverview'));
const ReportsPage = lazy(() => import('./pages/school/Reports'));
const SchoolSettingsPage = lazy(() => import('./pages/school/Settings'));
const SchoolBillingPage = lazy(() => import('./pages/school/Billing'));
const ExaminationsPage = lazy(() => import('./pages/school/Examinations'));
const SchoolFeesPage = lazy(() => import('./pages/school/SchoolFees'));
const StudentPromotionPage = lazy(() => import('./pages/school/StudentPromotion'));
// teacher + shared
const TeacherDashboard = lazy(() => import('./pages/teacher/Dashboard'));
const TeacherStudentsPage = lazy(() => import('./pages/teacher/TeacherStudents'));
const TeacherAttendancePage = lazy(() => import('./pages/teacher/TeacherAttendance'));
const TeacherGradesPage = lazy(() => import('./pages/teacher/TeacherGrades'));
const TeacherClassPage = lazy(() => import('./pages/teacher/ClassView'));
const TakeAttendancePage = lazy(() => import('./pages/shared/TakeAttendance'));
const GradeEntryPage = lazy(() => import('./pages/shared/GradeEntry'));
const ConsolidatedResultsPage = lazy(() => import('./pages/shared/ConsolidatedResults'));
const TerminalReportViewPage = lazy(() => import('./pages/shared/TerminalReportView'));
const BatchTerminalReportsPage = lazy(() => import('./pages/shared/BatchTerminalReports'));

export function App() {
  return (
    <Suspense fallback={<div className="center-page"><Spinner /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />

        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<RoleHome />} />
          <Route path="account" element={<AccountPage />} />

          <Route path="admin" element={<RequireRole need="super_admin"><AdminDashboard /></RequireRole>} />
          <Route path="admin/schools" element={<RequireRole need="super_admin"><AdminSchools /></RequireRole>} />
          <Route path="admin/schools/:schoolId" element={<RequireRole need="super_admin"><AdminSchoolDetail /></RequireRole>} />
          <Route path="admin/billing" element={<RequireRole need="super_admin"><AdminBilling /></RequireRole>} />
          <Route path="admin/renewals" element={<RequireRole need="super_admin"><AdminRenewals /></RequireRole>} />
          <Route path="admin/settings" element={<RequireRole need="super_admin"><AdminSettings /></RequireRole>} />
          <Route path="admin/audit" element={<RequireRole need="super_admin"><AuditPage scope="platform" /></RequireRole>} />

          <Route path="school" element={<RequireRole need="headmaster"><SchoolDashboard /></RequireRole>} />
          <Route path="school/students" element={<RequireRole need="headmaster"><StudentsPage /></RequireRole>} />
          <Route path="school/students/class/:classId" element={<RequireRole need="headmaster"><ClassStudentsPage /></RequireRole>} />
          <Route path="school/students/:studentId" element={<RequireRole need="headmaster"><StudentProfilePage /></RequireRole>} />
          <Route path="school/examinations" element={<RequireRole need="headmaster"><ExaminationsPage /></RequireRole>} />
          <Route path="school/consolidated" element={<RequireRole need="headmaster"><ConsolidatedResultsPage defaultRole="headmaster" /></RequireRole>} />
          <Route path="school/reports/terminal" element={<RequireRole need="headmaster"><BatchTerminalReportsPage /></RequireRole>} />
          <Route path="school/reports/terminal/:studentId" element={<RequireRole need="headmaster"><TerminalReportViewPage /></RequireRole>} />
          <Route path="school/promotions" element={<RequireRole need="headmaster"><StudentPromotionPage /></RequireRole>} />
          <Route path="school/fees" element={<RequireRole need="headmaster"><SchoolFeesPage /></RequireRole>} />
          <Route path="school/classes" element={<RequireRole need="headmaster"><ClassesPage /></RequireRole>} />
          <Route path="school/subjects" element={<RequireRole need="headmaster"><SubjectsPage /></RequireRole>} />
          <Route path="school/teachers" element={<RequireRole need="headmaster"><TeachersPage /></RequireRole>} />
          <Route path="school/academic" element={<RequireRole need="headmaster"><AcademicPage /></RequireRole>} />
          <Route path="school/attendance" element={<RequireRole need="headmaster"><AttendanceOverviewPage /></RequireRole>} />
          <Route path="school/grades" element={<RequireRole need="headmaster"><GradesOverviewPage /></RequireRole>} />
          <Route path="school/reports" element={<RequireRole need="headmaster"><ReportsPage /></RequireRole>} />
          <Route path="school/billing" element={<RequireRole need="headmaster"><SchoolBillingPage /></RequireRole>} />
          <Route path="school/settings" element={<RequireRole need="headmaster"><SchoolSettingsPage /></RequireRole>} />
          <Route path="school/audit" element={<Navigate to="/school" replace />} />

          <Route path="teach" element={<RequireRole need="teacher"><TeacherDashboard /></RequireRole>} />
          <Route path="teach/students" element={<RequireRole need="teacher"><TeacherStudentsPage /></RequireRole>} />
          <Route path="teach/consolidated" element={<RequireRole need="teacher"><ConsolidatedResultsPage defaultRole="teacher" /></RequireRole>} />
          <Route path="teach/reports" element={<RequireRole need="teacher"><BatchTerminalReportsPage /></RequireRole>} />
          <Route path="teach/reports/:studentId" element={<RequireRole need="teacher"><TerminalReportViewPage /></RequireRole>} />
          <Route path="teach/attendance" element={<RequireRole need="teacher"><TeacherAttendancePage /></RequireRole>} />
          <Route path="teach/grades" element={<RequireRole need="teacher"><TeacherGradesPage /></RequireRole>} />
          <Route path="teach/class/:classId" element={<RequireRole need="teacher"><TeacherClassPage /></RequireRole>} />
          <Route path="attendance/:classId" element={<RequireRole need="teacher"><TakeAttendancePage /></RequireRole>} />
          <Route path="grades/:classId/:subjectId" element={<RequireRole need="teacher"><GradeEntryPage /></RequireRole>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
