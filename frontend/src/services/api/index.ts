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
  updateUserProfile,
  // Organizations
  getCurrentOrganization,
  getOrgMembers,
  inviteMember,
  updateMemberRole,
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
  getMyDepartments,
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
  bulkImportResumes,
  createEntityFromResume,
  // Global search
  globalSearch
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
  GlobalSearchResponse
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
  ApplicationUpdate
} from './vacancies';
