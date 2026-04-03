// Re-export everything from all modules

// Client (axios instance and helpers)
export {
  default as api,
  deduplicatedGet,
  debouncedMutation,
  createStreamController,
  abortAllStreams,
  getPendingRequestsCount,
  getActiveStreamsCount,
  API_TIMEOUT,
  MUTATION_DEBOUNCE_MS
} from './client';

// Auth & Users
export {
  login,
  register,
  getCurrentUser,
  refreshToken,
  logoutAllDevices,
  getSessions,
  revokeSession,
  changePassword,
  getUsers,
  createUser,
  deleteUser,
  adminResetPassword,
  adminUpdateUser,
  updateUserProfile,
  // Organizations
  getCurrentOrganization,
  getOrgMembers,
  inviteMember,
  updateMemberRole,
  toggleMemberFullAccess,
  removeMember,
  getMyOrgRole,
  // Invitations
  createInvitation,
  getInvitations,
  validateInvitation,
  acceptInvitation,
  revokeInvitation,
  // Departments
  getDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentMembers,
  addDepartmentMember,
  updateDepartmentMember,
  removeDepartmentMember,
  quickAddDepartmentMember,
  getMyDepartments,
  getMyDeptRoles,
  getMyManagedUserIds,
  // Custom Roles
  getCustomRoles,
  getCustomRole,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  setRolePermission,
  removeRolePermission,
  assignCustomRole,
  unassignCustomRole,
  getPermissionAuditLogs,
  // User Permissions
  getMyPermissions,
  getMyMenu,
  getMyFeatures,
  // Sharing
  shareResource,
  revokeShare,
  getMyShares,
  getSharedWithMe,
  getResourceShares,
  getSharableUsers,
  shareChat,
  shareCall,
  shareEntity,
  // Feature Access
  getFeatureSettings,
  setFeatureAccess,
  deleteFeatureSetting,
  getFeatureAuditLogs
} from './auth';

// Auth types
export type {
  PasswordResetResponse,
  AdminUserUpdate,
  UserProfileUpdate,
  OrgRole,
  Organization,
  OrgMember,
  DeptRole,
  InviteMemberRequest,
  Invitation,
  InvitationValidation,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  Department,
  DepartmentMember,
  CustomRole,
  PermissionOverride,
  PermissionAuditLog,
  EffectivePermissions,
  MenuItem,
  MenuConfig,
  UserFeatures,
  ResourceType,
  AccessLevel,
  ShareRequest,
  ShareResponse,
  UserSimple,
  FeatureSetting,
  FeatureSettingsResponse,
  UserFeaturesResponse,
  SetFeatureAccessRequest,
  FeatureAuditLog
} from './auth';

// Entities
export {
  getEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  updateEntityStatus,
  transferEntity,
  linkChatToEntity,
  unlinkChatFromEntity,
  // Red flags
  getEntityRedFlags,
  getEntityRiskScore,
  getEntityStatsByType,
  getEntityStatsByStatus,
  // Smart search
  smartSearch,
  // Criteria
  getEntityCriteria,
  updateEntityCriteria,
  getEntityDefaultCriteria,
  setEntityDefaultCriteria,
  downloadEntityReport,
  // Similar & duplicates
  getSimilarCandidates,
  getDuplicateCandidates,
  mergeEntities,
  compareCandidates,
  compareCandidatesAI,
  downloadComparisonReport,
  // Files
  getEntityFiles,
  uploadEntityFile,
  deleteEntityFile,
  downloadEntityFile,
  // Parser
  parseResumeFromUrl,
  parseResumeFromFile,
  parseVacancyFromUrl,
  parseVacancyFromFile,
  splitVacancyDescription,
  bulkImportResumes,
  createEntityFromResume,
  // Global search
  globalSearch,
  // AI Profiles
  generateEntityProfile,
  getEntityProfile,
  getSimilarByProfile,
  generateAllProfiles,
  // Background parsing jobs
  startParseJob,
  getParseJobs,
  getParseJob,
  cancelParseJob
} from './entities';

// Entity types
export type {
  OwnershipFilter,
  RedFlag,
  RedFlagsAnalysis,
  RiskScoreResponse,
  SmartSearchResult,
  SmartSearchResponse,
  SmartSearchParams,
  EntityDefaultCriteriaResponse,
  SimilarCandidateResult,
  DuplicateCandidateResult,
  MergeEntitiesResponse,
  EntityFile,
  ParsedResume,
  ParsedVacancy,
  BulkImportResult,
  BulkImportResponse,
  CreateEntityFromResumeResponse,
  GlobalSearchCandidate,
  GlobalSearchVacancy,
  GlobalSearchResult,
  GlobalSearchResponse,
  AIProfile,
  ProfileResponse,
  SimilarByProfileResponse,
  BulkProfileResponse,
  ParseJobStatus,
  ParseJob,
  ParseJobsListResponse
} from './entities';

// Chats
export {
  getChats,
  getChat,
  updateChat,
  deleteChat,
  getDeletedChats,
  restoreChat,
  permanentDeleteChat,
  // Messages
  getMessages,
  getParticipants,
  transcribeMessage,
  // Criteria
  getCriteriaPresets,
  createCriteriaPreset,
  updateCriteriaPreset,
  deleteCriteriaPreset,
  getChatCriteria,
  updateChatCriteria,
  getDefaultCriteria,
  setDefaultCriteria,
  resetDefaultCriteria,
  seedUniversalPresets,
  // AI
  getAIHistory,
  clearAIHistory,
  getAnalysisHistory,
  // Stats
  getStats,
  // Streaming
  streamAIMessage,
  streamQuickAction,
  // Reports
  downloadReport,
  // Import
  importTelegramHistory,
  getImportProgress,
  generateImportId,
  cleanupBadImport,
  // Transcription
  transcribeAllMedia,
  repairVideoNotes
} from './chats';

// Chat types
export type {
  DefaultCriteriaResponse,
  StreamOptions,
  ImportResult,
  ImportProgress,
  CleanupResult,
  CleanupMode,
  TranscribeAllResult,
  RepairVideoResult
} from './chats';

// Calls
export {
  getCalls,
  getCall,
  uploadCallRecording,
  uploadTextCall,
  startCallBot,
  getCallStatus,
  stopCallRecording,
  deleteCall,
  linkCallToEntity,
  reprocessCall,
  updateCall,
  // External links
  detectExternalLinkType,
  processExternalURL,
  getExternalProcessingStatus,
  getSupportedExternalTypes,
  // Currency
  getExchangeRates,
  convertCurrencyApi,
  getSupportedCurrencies
} from './calls';

// Call types
export type {
  ExternalLinkType,
  DetectLinkTypeResponse,
  ProcessURLResponse,
  ExchangeRatesResponse,
  CurrencyConversionRequest,
  CurrencyConversionResponse,
  SupportedCurrency,
  SupportedCurrenciesResponse
} from './calls';

// Vacancies
export {
  getVacancies,
  getVacancy,
  createVacancy,
  updateVacancy,
  deleteVacancy,
  // Applications
  getApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  // Kanban
  getKanbanBoard,
  bulkMoveApplications,
  // Stats
  getVacancyStats,
  // Entity-Vacancy
  getEntityVacancies,
  applyEntityToVacancy,
  // Recommendations
  getRecommendedVacancies,
  autoApplyToVacancy,
  getMatchingCandidates,
  notifyMatchingCandidates,
  inviteCandidateToVacancy,
  // Assignable users
  getAssignableUsers,
  // AI Scoring
  calculateCompatibilityScore,
  findBestMatchesForVacancy,
  findMatchingVacanciesForEntity,
  getApplicationScore,
  recalculateApplicationScore,
  bulkCalculateScores
} from './vacancies';

// Vacancy types
export type {
  VacancyFilters,
  VacancyCreate,
  VacancyUpdate,
  ApplicationCreate,
  ApplicationUpdate,
  AssignableUser
} from './vacancies';

// Projects
export {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  // Members
  getProjectMembers,
  addProjectMember,
  updateProjectMember,
  removeProjectMember,
  // Tasks
  getProjectTasks,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  getTaskKanban,
  bulkMoveTasks,
  getSubtasks,
  // Milestones
  getProjectMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  // Time logs
  createTimeLog,
  getTaskTimeLogs,
  // Effort & Analytics
  getProjectEffort,
  getProjectsOverview,
  getResourceAllocation,
  getProjectAnalytics,
  getAllTasks,
  // Custom fields
  getCustomFields,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  getTaskFieldValues,
  setTaskFieldValue,
  // Task statuses
  getProjectStatuses,
  createProjectStatus,
  updateProjectStatus,
  deleteProjectStatus,
  reorderProjectStatuses,
  // Task comments
  getTaskComments,
  createTaskComment,
  updateTaskComment,
  deleteTaskComment,
  // Task attachments
  getTaskAttachments,
  uploadTaskAttachment,
  deleteTaskAttachment,
  // AI task creation
  aiParsePlan,
  aiCreateTasks,
  // Saturn integration
  getSaturnProjects,
  getSaturnProject,
  triggerSaturnSync,
  getSaturnSyncStatus,
  // Project status definitions (org-level)
  getProjectStatusDefs,
  createProjectStatusDef,
  updateProjectStatusDef,
  deleteProjectStatusDef,
  reorderProjectStatusDefs,
} from './projects';

// Project types
export type {
  ProjectStatus,
  TaskStatus,
  ProjectRole,
  Project,
  ProjectMember,
  ProjectTask,
  ProjectMilestone,
  TaskTimeLog,
  TaskKanbanColumn,
  TaskKanbanBoard,
  ProjectFilters,
  ProjectCreate,
  ProjectUpdate,
  TaskCreate,
  TaskUpdate,
  MemberCreate,
  MemberUpdate,
  MilestoneCreate,
  TimeLogCreate,
  ProjectEffort,
  ProjectsOverview,
  ResourceAllocation,
  ProjectAnalytics,
  AllTasksProjectGroup,
  AllTasksFilters,
  CustomFieldType,
  ProjectCustomField,
  TaskFieldValue,
  ProjectTaskStatusDef,
  TaskComment,
  TaskAttachment,
  ParsedTaskItem,
  AIParsePlanResponse,
  SaturnProject,
  SaturnApplication,
  SaturnSyncStatus,
  ProjectStatusDef2,
} from './projects';

// Interns (Prometheus proxy)
export {
  getPrometheusInterns,
  getPrometheusAnalytics,
  getStudentAchievements,
  getContactPrometheusReview,
  getContactDetailedReview,
  exportInternToContact,
  getInternLinkedContacts,
  syncPrometheusStatuses,
  syncPrometheusStatusSingle,
} from './interns';

// Intern types
export type {
  PrometheusIntern,
  PrometheusTrailSummary,
  PrometheusInternsResponse,
  PrometheusAnalyticsResponse,
  ChurnRisk,
  ChurnRiskStudent,
  FunnelStage,
  TrendPoint,
  ModuleDifficulty,
  AnalyticsSummary,
  TrailProgressItem,
  AnalyticsTopStudent,
  ScoreDistribution,
  DropoffModule,
  DropoffTrail,
  StudentModuleStatus,
  StudentByTrail,
  StudentsByTrailItem,
  AnalyticsTrailFilter,
  AnalyticsFilters,
  StudentAchievementsResponse,
  StudentInfo,
  Achievement,
  AchievementsData,
  SubmissionStats,
  StudentTrailProgress,
  Certificate,
  ContactReviewTrail,
  ContactPrometheusReview,
  ContactPrometheusIntern,
  ContactPrometheusResponse,
  CompetencyScore,
  ProfessionalProfile,
  CompetencyAnalysis,
  TrailInsight,
  TeamFitRecommendation,
  DetailedPrometheusReview,
  DetailedReviewResponse,
  ExportInternResponse,
  LinkedContactsResponse,
  SyncStatusResult,
  SyncStatusesResponse,
  SyncSingleStatusResponse,
} from './interns';

// Notifications
export {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from './notifications';

export type {
  Notification as AppNotification,
  UnreadCountResponse,
} from './notifications';
