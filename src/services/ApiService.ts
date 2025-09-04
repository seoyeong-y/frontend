import apiClient from '../config/apiClient';
import { courseToSlot } from "@/utils/mapper";

// 캐시와 debouncing을 위한 유틸리티
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5분

// 캐시 헬퍼 함수
const getCachedData = (key: string) => {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
        return cached.data;
    }
    cache.delete(key);
    return null;
};

const setCachedData = (key: string, data: any, ttl: number = CACHE_TTL) => {
    cache.set(key, { data, timestamp: Date.now(), ttl });
};

// Debounce 함수
const debounce = <T extends (...args: any[]) => any>(
    func: T,
    wait: number
): ((...args: Parameters<T>) => Promise<ReturnType<T>>) => {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        return new Promise((resolve) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => resolve(func(...args)), wait);
        });
    };
};

// ===== 타입 정의 =====
export interface BackendUser {
    userId: string;
    email: string;
    name: string;
    studentId?: string;
    major?: string;
    grade?: number;
    semester?: number;
    phone?: string;
    provider?: string;
    createdAt?: string;
    enrollmentYear?: number;
    graduationYear?: number;
}

export interface BackendProfile {
    userId: string;
    email: string;
    name: string;
    studentId?: string;
    major?: string;
    grade?: number;
    semester?: number;
    phone?: string;
    onboardingCompleted?: boolean;
    provider?: string;
    createdAt?: string;
}

export interface BackendRecord {
    id: string;
    courseName: string;
    courseCode: string;
    credits: number;
    grade: string;
    semester: string;
    year: number;
    category: string;
}

export interface BackendCurriculum {
    id: string;
    name: string;
    type: string;
    subjects: any[];
    totalCredits: number;
    requiredCredits: number;
}

export interface BackendTimetable {
    id: number;
    userId: number;
    semesterCode: string;
    year: number;
    created_at: string;
    updated_at: string;
    courses?: any[];
    TimetableSlots?: any[];
}


export interface BackendNote {
    id: string;
    userId?: string;
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    pinned?: boolean;
    archived?: boolean;
    order?: number;
    createdAt: string;
    updatedAt: string;
}

export interface BackendNotification {
    id: string;
    title: string;
    message: string;
    type: string;
    isRead: boolean;
    createdAt: string;
}

export interface BackendGraduationStatus {
    totalCredits: number;
    majorCredits: number;
    liberalCredits: number;
    requiredCourses: string[];
    missingCourses: string[];
    isGraduationReady: boolean;
}

// ===== API Response 타입 =====
interface ApiResponse<T> {
    success: boolean;
    message?: string;
    data: T;
}

// ===== 통합 API 서비스 클래스 =====
class ApiService {
    private static instance: ApiService;

    public static getInstance(): ApiService {
        if (!ApiService.instance) {
            ApiService.instance = new ApiService();
        }
        return ApiService.instance;
    }

    // ===== 프로필 관리 =====
    async getProfile(): Promise<BackendProfile | null> {
        const userEmail = typeof window !== 'undefined' ? localStorage.getItem('userEmail') || 'anonymous' : 'anonymous';
        const cacheKey = `user_profile_${userEmail}`;
        const cached = getCachedData(cacheKey);
        if (cached) {
            console.log('[ApiService] Using cached profile data');
            return cached;
        }

        console.log('[ApiService] Fetching user profile');
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendProfile>>('/profile');
            if (!res.success) {
                console.warn('[ApiService] profile empty - returning null');
                return null;
            }
            const profileData = res.data;
            setCachedData(cacheKey, profileData);
            return profileData;
        } catch (error: any) {
            console.error('[ApiService] Failed to fetch profile:', error);
            return null;
        }
    }

    async completeOnboarding(onboardingData: any): Promise<void> {
        console.log('[ApiService] Completing onboarding with data:', onboardingData);
        try {
            await apiClient.post('/profile/complete-onboarding', onboardingData);

            // 온보딩 완료 후 캐시 무효화 (사용자별 키)
            const userEmail = (typeof window !== 'undefined') ? localStorage.getItem('userEmail') || 'anonymous' : 'anonymous';
            const cacheKey = `user_profile_${userEmail}`;
            cache.delete(cacheKey);

            console.log('[ApiService] Onboarding completed successfully (cache cleared)');
        } catch (error) {
            console.error('[ApiService] Failed to complete onboarding:', error);
            throw error;
        }
    }

    async updateProfile(updates: { username?: string; phone?: string; major?: string }): Promise<BackendProfile> {
        console.log('[ApiService] Updating user profile:', updates);
        try {
            const response = await apiClient.put<{ success: boolean; message: string; data: any }>('/profile', updates);
            const updatedProfile = response.data.data;

            // 캐시 무효화 및 새 데이터로 업데이트 (사용자별 키로)
            const userEmail = (typeof window !== 'undefined') ? localStorage.getItem('userEmail') || 'anonymous' : 'anonymous';
            const cacheKey = `user_profile_${userEmail}`;
            cache.delete(cacheKey);
            setCachedData(cacheKey, updatedProfile);

            return updatedProfile;
        } catch (error) {
            console.error('[ApiService] Failed to update profile:', error);
            throw error;
        }
    }
    
    async getSemesters(): Promise<string[]> {
        console.log('[ApiService] Fetching semesters');
        try {
            const { data: res } = await apiClient.get<ApiResponse<string[]>>('/timetable/semesters');
            if (!res.success) throw new Error(res.message || 'Failed to fetch semesters');
            return res.data || [];
        } catch (error) {
            console.error('[ApiService] Failed to fetch semesters:', error);
            // 에러 발생 시 기본 학기 목록 반환
            const currentYear = new Date().getFullYear();
            return [
                `${currentYear-1}-2학기`,
                `${currentYear}-1학기`,
                `${currentYear}-2학기`
            ];
        }
    }

// ===== 시간표 관리 (완전 연동) =====
    
    /**
     * 현재 학기 시간표 조회
     */
    async getCurrentTimetable(semester: string): Promise<BackendTimetable | null> {
        console.log('[ApiService] Fetching current timetable for semester:', semester);
        try {
            const response = await apiClient.get<ApiResponse<BackendTimetable>>('/timetable/current', {
                params: { semester }
            });
            
            console.log('[ApiService] Current timetable raw response:', response.data);
            
            const { data: res } = response;
            if (!res.success) {
                console.warn('[ApiService] Current timetable not found:', res.message);
                return null;
            }
            
            console.log('[ApiService] Current timetable loaded successfully:', res.data);
            return res.data || null;
        } catch (error: any) {
            if (error.response?.status === 404) {
                console.log('[ApiService] No current timetable exists');
                return null;
            }
            
            console.error('[ApiService] Failed to fetch current timetable:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            
            throw error;
        }
    }

    /**
     * 특정 학기 시간표 조회
     */
    async getTimetableBySemester(semester: string): Promise<BackendTimetable | null> {
        console.log('[ApiService] Fetching timetable for semester:', semester);
        try {
            const encoded = encodeURIComponent(semester);  // 👈 인코딩 추가
            const { data: res } = await apiClient.get<ApiResponse<BackendTimetable>>(`/timetable/semester/${encoded}`);
            if (!res.success) {
                console.warn('[ApiService] Timetable not found for semester:', semester);
                return null;
            }
            const timetableData = res.data;
            console.log('[ApiService] Parsed timetable data:', JSON.stringify(timetableData, null, 2));
        
            if (timetableData) {
                console.log('[ApiService] Timetable data keys:', Object.keys(timetableData));
                console.log('[ApiService] TimetableSlots:', timetableData.TimetableSlots);
                console.log('[ApiService] courses:', timetableData.courses);
            }
            return res.data || null;
        } catch (error: any) {
            if (error.response?.status === 404) {
                console.log('[ApiService] No timetable exists for semester:', semester);
                return null;
            }
            console.error('[ApiService] Failed to fetch semester timetable:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                url: error.config?.url
            });
            throw error;
        }
    }


    /**
     * 시간표 저장 (새로 생성 또는 업데이트)
     */
    async saveTimetable(timetableData: {
        semester: string;
        courses: any[];
        updatedAt?: string;
    }): Promise<BackendTimetable> {
        console.log('[ApiService] Saving timetable:', timetableData);
        
        try {
            // 데이터 검증
            if (!timetableData.semester) {
                throw new Error('Semester is required');
            }
            if (!Array.isArray(timetableData.courses)) {
                throw new Error('Courses must be an array');
            }

            const payload = {
                semesterCode: timetableData.semester, 
                courses: (timetableData.courses || []).map(course => courseToSlot(course)),
                year: new Date().getFullYear(),
                updatedAt: timetableData.updatedAt || new Date().toISOString()
            };

            // 기존 시간표가 있는지 확인
            const existingTimetable = await this.getTimetableBySemester(timetableData.semester);
            
            let response;
            if (existingTimetable?.id) {
                // 업데이트
                console.log('[ApiService] Updating existing timetable');
                response = await apiClient.put<ApiResponse<BackendTimetable>>(
                    `/timetable/${existingTimetable.id}`, 
                    payload
                );
            } else {
                // 새로 생성
                console.log('[ApiService] Creating new timetable');
                response = await apiClient.post<ApiResponse<BackendTimetable>>(
                    '/timetable', 
                    payload
                );
            }

            if (!response.data.success) {
                throw new Error(response.data.message || 'Failed to save timetable');
            }

            console.log('[ApiService] Timetable saved successfully');
            return response.data.data;
        } catch (error) {
            console.error('[ApiService] Failed to save timetable:', error);
            throw error;
        }
    }

    /**
     * 시간표 삭제
     */
    async deleteTimetable(semester: string): Promise<boolean> {
        console.log('[ApiService] Deleting timetable for semester:', semester);
        
        try {
            const existingTimetable = await this.getTimetableBySemester(semester);
            
            if (!existingTimetable?.id) {
                console.log('[ApiService] No timetable to delete for semester:', semester);
                return true; // 이미 없으면 성공으로 간주
            }

            const { data: res } = await apiClient.delete<ApiResponse<boolean>>(
                `/timetable/${existingTimetable.id}`
            );

            if (!res.success) {
                throw new Error(res.message || 'Failed to delete timetable');
            }

            console.log('[ApiService] Timetable deleted successfully');
            return true;
        } catch (error) {
            console.error('[ApiService] Failed to delete timetable:', error);
            throw error;
        }
    }

    /**
     * 시간표에 과목 추가
     */
    async addCourseToTimetable(semester: string, courseData: {
        name: string;
        code?: string;
        instructor?: string;
        credits?: number;
        type?: string;
        day: string;
        startTime: string;
        endTime: string;
        startPeriod?: number;
        endPeriod?: number;
        room?: string;
    }): Promise<BackendTimetable> {
        console.log('[ApiService] Adding course to timetable:', courseData);
        
        try {
            const currentTimetable = await this.getTimetableBySemester(semester);
            
            const newCourse = {
                id: Date.now().toString(),
                ...courseData
            };

            const updatedCourses = currentTimetable 
                ? [...(currentTimetable.courses || []), newCourse]
                : [newCourse];

            return await this.saveTimetable({
                semester,
                courses: updatedCourses
            });
        } catch (error) {
            console.error('[ApiService] Failed to add course to timetable:', error);
            throw error;
        }
    }

    /**
     * 시간표에서 과목 제거
     */
    async removeCourseFromTimetable(semester: string, courseId: string): Promise<BackendTimetable> {
        console.log('[ApiService] Removing course from timetable:', courseId);
        
        try {
            const currentTimetable = await this.getTimetableBySemester(semester);
            
            if (!currentTimetable?.courses) {
                throw new Error('No timetable found for semester: ' + semester);
            }

            const updatedCourses = currentTimetable.courses.filter(
                (course: any) => course.id !== courseId
            );

            return await this.saveTimetable({
                semester,
                courses: updatedCourses
            });
        } catch (error) {
            console.error('[ApiService] Failed to remove course from timetable:', error);
            throw error;
        }
    }

    /**
     * 시간표 과목 수정
     */
    async updateCourseInTimetable(semester: string, courseId: string, updates: Partial<{
        name: string;
        code: string;
        instructor: string;
        credits: number;
        type: string;
        day: string;
        startTime: string;
        endTime: string;
        startPeriod: number;
        endPeriod: number;
        room: string;
    }>): Promise<BackendTimetable> {
        console.log('[ApiService] Updating course in timetable:', courseId, updates);
        
        try {
            const currentTimetable = await this.getTimetableBySemester(semester);
            
            if (!currentTimetable?.courses) {
                throw new Error('No timetable found for semester: ' + semester);
            }

            const updatedCourses = currentTimetable.courses.map((course: any) => 
                course.id === courseId 
                    ? { ...course, ...updates }
                    : course
            );

            return await this.saveTimetable({
                semester,
                courses: updatedCourses
            });
        } catch (error) {
            console.error('[ApiService] Failed to update course in timetable:', error);
            throw error;
        }
    }

    /**
     * 사용자의 모든 시간표 조회
     */
    async getAllTimetables(): Promise<BackendTimetable[]> {
        console.log('[ApiService] Fetching all user timetables');
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendTimetable[]>>('/timetable/all');
            if (!res.success) {
                throw new Error(res.message || 'Failed to fetch all timetables');
            }
            console.log('[ApiService] All timetables loaded successfully');
            return res.data || [];
        } catch (error) {
            console.error('[ApiService] Failed to fetch all timetables:', error);
            throw error;
        }
    }

    /**
     * 시간표 복사
     */
    async copyTimetable(fromSemester: string, toSemester: string): Promise<BackendTimetable> {
        console.log('[ApiService] Copying timetable from', fromSemester, 'to', toSemester);
        
        try {
            const sourceTimetable = await this.getTimetableBySemester(fromSemester);
            
            if (!sourceTimetable) {
                throw new Error('Source timetable not found: ' + fromSemester);
            }

            return await this.saveTimetable({
                semester: toSemester,
                courses: sourceTimetable.courses || []
            });
        } catch (error) {
            console.error('[ApiService] Failed to copy timetable:', error);
            throw error;
        }
    }

    /**
     * 시간표 충돌 검사
     */
    async checkTimetableConflicts(semester: string, newCourse: {
        day: string;
        startTime: string;
        endTime: string;
        startPeriod?: number;
        endPeriod?: number;
    }): Promise<{
        hasConflict: boolean;
        conflicts: any[];
    }> {
        console.log('[ApiService] Checking timetable conflicts');
        
        try {
            const currentTimetable = await this.getTimetableBySemester(semester);
            
            if (!currentTimetable?.courses) {
                return { hasConflict: false, conflicts: [] };
            }

            const conflicts = currentTimetable.courses.filter((course: any) => {
                if (course.day !== newCourse.day) return false;
                
                // 시간 기반 충돌 검사
                if (newCourse.startTime && newCourse.endTime && course.startTime && course.endTime) {
                    const newStart = new Date(`1970-01-01 ${newCourse.startTime}`);
                    const newEnd = new Date(`1970-01-01 ${newCourse.endTime}`);
                    const existingStart = new Date(`1970-01-01 ${course.startTime}`);
                    const existingEnd = new Date(`1970-01-01 ${course.endTime}`);
                    
                    return (newStart < existingEnd && newEnd > existingStart);
                }
                
                // 교시 기반 충돌 검사
                if (newCourse.startPeriod && newCourse.endPeriod && course.startPeriod && course.endPeriod) {
                    return (newCourse.startPeriod < course.endPeriod && newCourse.endPeriod > course.startPeriod);
                }
                
                return false;
            });

            return {
                hasConflict: conflicts.length > 0,
                conflicts
            };
        } catch (error) {
            console.error('[ApiService] Failed to check conflicts:', error);
            throw error;
        }
    }

    // ===== 수강 기록 관리 =====
    async getRecords(): Promise<BackendRecord[]> {
        console.log('[ApiService] Fetching user records');
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendRecord[]>>('/records');
            return res.success ? res.data : [];
        } catch (error) {
            console.error('[ApiService] Failed to fetch records:', error);
            return [];
        }
    }

    async addRecord(record: Omit<BackendRecord, 'id'>): Promise<BackendRecord | null> {
        console.log('[ApiService] Adding new record:', record);
        try {
            const { data: res } = await apiClient.post<ApiResponse<BackendRecord>>('/records', record);
            return res.success ? res.data : null;
        } catch (error) {
            console.error('[ApiService] Failed to add record:', error);
            return null;
        }
    }

    async updateRecord(id: string, updates: Partial<BackendRecord>): Promise<BackendRecord | null> {
        console.log('[ApiService] Updating record:', id, updates);
        try {
            const { data: res } = await apiClient.put<ApiResponse<BackendRecord>>(`/records/${id}`, updates);
            return res.success ? res.data : null;
        } catch (error) {
            console.error('[ApiService] Failed to update record:', error);
            return null;
        }
    }

    async deleteRecord(id: string): Promise<boolean> {
        console.log('[ApiService] Deleting record:', id);
        try {
            const { data: res } = await apiClient.delete<ApiResponse<null>>(`/records/${id}`);
            return res.success;
        } catch (error) {
            console.error('[ApiService] Failed to delete record:', error);
            return false;
        }
    }

    // ===== 커리큘럼 관리 =====
    async getCurriculums(): Promise<BackendCurriculum[]> {
        console.log('[ApiService] Fetching curriculums');
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendCurriculum[]>>('/curriculums');
            return res.success ? res.data : [];
        } catch (error) {
            console.error('[ApiService] Failed to fetch curriculums:', error);
            return [];
        }
    }

    async getCurriculumById(id: string): Promise<BackendCurriculum | null> {
        console.log('[ApiService] Fetching curriculum by ID:', id);
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendCurriculum>>(`/curriculums/${id}`);
            return res.success ? res.data : null;
        } catch (error) {
            console.error('[ApiService] Failed to fetch curriculum:', error);
            return null;
        }
    }

    // ===== 노트 관리 =====
    async getNotes(): Promise<BackendNote[]> {
        console.log('[ApiService] Fetching notes');
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendNote[]>>('/notes');
            console.log('[ApiService] Notes response:', res);
            if (!res.success) throw new Error(res.message || 'Failed to fetch notes');
            return res.data || [];
        } catch (error: any) {
            console.error('[ApiService] Failed to fetch notes:', error);
            console.error('[ApiService] Error details:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
            return [];
        }
    }

    async addNote(note: Omit<BackendNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<BackendNote | null> {
        console.log('[ApiService] Adding note:', note);
        try {
            const { data: res } = await apiClient.post<ApiResponse<BackendNote>>('/notes', note);
            if (!res.success) throw new Error(res.message || 'Failed to add note');
            return res.data;
        } catch (error) {
            console.error('[ApiService] Failed to add note:', error);
            return null;
        }
    }

    async updateNote(id: string, updates: Partial<BackendNote>): Promise<BackendNote | null> {
        if (!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/.test(id)) {
            console.error('[ApiService] invalid id →', id);
            throw new Error('Invalid note id');
        }
        // 필드명 매핑: pinned → isPinned, archived → isArchived
        const mappedUpdates = {
            ...updates,
            isPinned: updates.pinned !== undefined ? updates.pinned : updates.isPinned,
            isArchived: updates.archived !== undefined ? updates.archived : updates.isArchived,
        };
        delete (mappedUpdates as any).pinned;
        delete (mappedUpdates as any).archived;
        console.log('[ApiService] Updating note:', id, mappedUpdates);
        try {
            const { data: res } = await apiClient.patch<ApiResponse<BackendNote>>(`/notes/${id}`, mappedUpdates);
            if (!res.success) throw new Error(res.message || 'Failed to update note');
            return res.data;
        } catch (error) {
            console.error('[ApiService] Failed to update note:', error);
            return null;
        }
    }

    async deleteNote(id: string): Promise<boolean> {
        console.log('[ApiService] Deleting note:', id);
        // UUID 형식 검증 추가
        if (!/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/.test(id)) {
            console.error(`[ApiService] Invalid note id: ${id}`);
            throw new Error(`Invalid note id: ${id}`);
        }
        try {
            const { data: res } = await apiClient.delete<ApiResponse<null>>(`/notes/${encodeURIComponent(id)}`);
            if (!res.success) throw new Error(res.message || 'Failed to delete note');
            return true;
        } catch (error) {
            console.error('[ApiService] Failed to delete note:', error);
            return false;
        }
    }

    /**
     * 사용자별 프로필 캐시 삭제
     * @param email 특정 사용자의 이메일. 전달하지 않으면 localStorage 의 userEmail 값을 사용합니다.
     */
    clearProfileCache(email?: string): void {
        const userEmail = email || (typeof window !== 'undefined' ? localStorage.getItem('userEmail') || 'anonymous' : 'anonymous');
        const key = `user_profile_${userEmail}`;
        if (cache.delete(key)) {
            console.log(`[ApiService] Cleared profile cache for ${userEmail}`);
        }
    }

    /**
     * 모든 사용자 프로필 캐시를 삭제합니다 (메모리 회수용)
     */
    clearAllProfileCache(): void {
        Array.from(cache.keys()).forEach((key) => {
            if (key.startsWith('user_profile_')) {
                cache.delete(key);
            }
        });
        console.log('[ApiService] Cleared ALL user_profile caches');
    }

    // ===== 알림 관리 =====
    async getNotifications(): Promise<BackendNotification[]> {
        console.log('[ApiService] Fetching notifications');
        try {
            const { data: res } = await apiClient.get<ApiResponse<BackendNotification[]>>('/notifications');
            console.log('[ApiService] Notifications response:', res);
            if (!res.success) throw new Error(res.message || 'Failed to fetch notifications');
            return res.data || [];
        } catch (error: any) {
            console.error('[ApiService] Failed to fetch notifications:', error);
            console.error('[ApiService] Error details:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
            return [];
        }
    }

    async markNotificationAsRead(id: string): Promise<boolean> {
        console.log('[ApiService] Marking notification as read:', id);
        try {
            const response = await apiClient.patch<{ success: boolean; message?: string }>(`/notifications/${id}/read`);
            if (!response.success) {
                throw new Error(response.message || 'Failed to mark notification as read');
            }
            return true;
        } catch (error) {
            console.error('[ApiService] Failed to mark notification as read:', error);
            return false;
        }
    }

    // ===== 졸업 관리 =====
    async getGraduationStatus(): Promise<BackendGraduationStatus> {
        console.log('[ApiService] Fetching graduation status');
        try {
            const response = await apiClient.get<any>('/api/graduation/status');
            const statusData = response.status || response.data;

            // 백엔드 응답을 프론트엔드가 기대하는 형식으로 변환
            return {
                totalCredits: statusData.pass?.total?.actual || 0,
                majorCredits: statusData.pass?.major?.actual || 0,
                liberalCredits: statusData.pass?.liberal?.actual || 0,
                requiredCourses: [],
                missingCourses: statusData.missingCourses?.missing || [],
                isGraduationReady: (statusData.pass?.total?.passed &&
                    statusData.pass?.major?.passed &&
                    statusData.pass?.liberal?.passed) || false
            };
        } catch (error) {
            console.error('[ApiService] Failed to fetch graduation status:', error);
            // 실패 시 기본값 반환
            return {
                totalCredits: 0,
                majorCredits: 0,
                liberalCredits: 0,
                requiredCourses: [],
                missingCourses: [],
                isGraduationReady: false
            };
        }
    }

    // ===== 대시보드 요약 정보 =====
    async getDashboardSummary(): Promise<{
        totalCredits: number;
        graduationProgress: number;
        upcomingCourses: any[];
        recentNotes: BackendNote[];
        notifications: BackendNotification[];
        canGraduate?: boolean;
        missingRequiredCourses?: any[];
        recommendations?: any[];
    }> {
        console.log('[ApiService] Fetching dashboard summary');

        // 먼저 인증 토큰 확인
        const token = localStorage.getItem('accessToken');
        if (!token) {
            console.warn('[ApiService] No access token found, using mock data');
            return this.getMockDashboardData();
        }

        try {
            const [
                graduationStatus,
                timetable,
                notes,
                notifications
            ] = await Promise.allSettled([
                this.getGraduationStatus(),
                this.getCurrentTimetable(),
                this.getNotes(),
                this.getNotifications()
            ]);

            const graduationData = graduationStatus.status === 'fulfilled' ? graduationStatus.value : null;
            const totalCredits = graduationData?.totalCredits || 0;

            return {
                totalCredits,
                graduationProgress: graduationData?.progressRatio || Math.round((totalCredits / 130) * 100),
                canGraduate: graduationData?.canGraduate || false,
                missingRequiredCourses: graduationData?.missingCourses || [],
                recommendations: graduationData?.recommendations || [],
                upcomingCourses: timetable.status === 'fulfilled' ? (timetable.value?.courses || []) : [],
                recentNotes: notes.status === 'fulfilled' ? (notes.value || []).slice(0, 5) : [],
                notifications: notifications.status === 'fulfilled' ? (notifications.value || []).filter(n => !n.isRead) : []
            };
        } catch (error) {
            console.error('[ApiService] Failed to fetch dashboard summary:', error);
            return this.getMockDashboardData();
        }
    }

    // Mock 대시보드 데이터 (인증 실패 시 대안)
    private getMockDashboardData() {
        return {
            totalCredits: 89,
            graduationProgress: 68,
            canGraduate: false,
            upcomingCourses: [
                { name: '컴퓨터네트워크', time: '월 13:30-15:20' },
                { name: '웹서비스프로그래밍', time: '화 10:30-12:20' }
            ],
            recentNotes: [
                { title: '알고리즘 정리', content: '퀵소트, 머지소트 구현' },
                { title: '네트워크 과제', content: 'TCP/IP 모델 정리' }
            ],
            notifications: [
                { title: '과제 제출 마감', message: '데이터베이스 과제 내일까지', isRead: false }
            ],
            missingRequiredCourses: [
                { name: '종합설계기획', credits: 1 },
                { name: '종합설계1', credits: 3 },
                { name: '종합설계2', credits: 3 }
            ],
            recommendations: [
                { type: 'major_required', message: '종합설계 과목 이수를 권장합니다.' }
            ]
        };
    }
}

export const apiService = ApiService.getInstance(); 