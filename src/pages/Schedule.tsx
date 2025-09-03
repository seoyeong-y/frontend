// src/pages/Schedule.tsx

import React, { useState, useCallback, lazy, Suspense, useRef, useEffect } from 'react';
import { Box, Typography, Paper, FormControl, InputLabel, Select, MenuItem, Button, Snackbar, Alert, CircularProgress, Fab, Backdrop, IconButton, Tooltip, Fade, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Menu as MuiMenu, MenuItem as MuiMenuItem } from '@mui/material';
import { School, Image, Add } from '@mui/icons-material';
import { SelectChangeEvent } from '@mui/material/Select';
import FabAddCourse from '../components/FabAddCourse';
import type { Course } from '../types/course';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule, useData } from '../contexts/SeparatedDataContext';
import TimetableGrid from '../components/timetable/TimetableGrid';
import { useLocation } from 'react-router-dom';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { ApiError, ErrorCode } from '../errors/ApiError';
import apiClient from '../config/apiClient';
import { slotToCourse, courseToSlot } from "@/utils/mapper";

const CourseEditModal = lazy(() => import('../components/modals/CourseEditModal'));
const CourseDetailModal = lazy(() => import('../components/modals/CourseDetailModal'));

const ExcelUploadModal = ({ open, onClose, onUpload }: { 
    open: boolean; 
    onClose: () => void; 
    onUpload: (file: File) => void; 
}) => (
    <Dialog open={open} onClose={onClose}>
        <DialogTitle>시간표 엑셀 업로드</DialogTitle>
        <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                포털 사이트에 접속하여 <b>학적 → 학적정보조회 → 수강내역</b> 메뉴에서 
                해당 연도를 선택한 뒤, <b>엑셀 다운로드</b> 버튼을 눌러 받은 파일을 업로드해주세요.
            </Typography>
            <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                    if (e.target.files?.[0]) {
                        onUpload(e.target.files[0]);
                    }
                }}
            />
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose}>취소</Button>
        </DialogActions>
    </Dialog>
);

// 커스텀 훅들
function useDialog<T = any>() {
    const [open, setOpen] = useState(false);
    const [data, setData] = useState<T | null>(null);
    const openDialog = (d?: T) => {
        setData(d || null);
        setOpen(true);
    };
    const closeDialog = () => setOpen(false);
    return { open, data, openDialog, closeDialog, setData };
}

function useSnackbar() {
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity?: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '' });
    const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'success') => setSnackbar({ open: true, message, severity });
    const closeSnackbar = () => setSnackbar(s => ({ ...s, open: false }));
    return { ...snackbar, showSnackbar, closeSnackbar };
}

// API 에러 처리 유틸리티
const handleApiError = (error: any, showSnackbar: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void) => {
    console.error('API Error:', error);

    if (error instanceof ApiError) {
        switch (error.code) {
            case ErrorCode.AUTHENTICATION_ERROR:
                showSnackbar('인증이 만료되었습니다. 다시 로그인해주세요.', 'error');
                setTimeout(() => window.location.href = '/login', 2000);
                break;
            case ErrorCode.AUTHORIZATION_ERROR:
                showSnackbar('권한이 없습니다.', 'error');
                break;
            case ErrorCode.VALIDATION_ERROR:
                showSnackbar('입력 데이터를 확인해주세요.', 'error');
                break;
            case ErrorCode.NETWORK_ERROR:
                showSnackbar('네트워크 연결을 확인해주세요.', 'error');
                break;
            default:
                showSnackbar('오류가 발생했습니다. 다시 시도해주세요.', 'error');
        }
    } else {
        showSnackbar('예상치 못한 오류가 발생했습니다.', 'error');
    }
};

const Schedule: React.FC = () => {
    const { isAuthenticated, user } = useAuth();
    const { userData, updateSettings } = useData();
    const { open: snackbarOpen, message, severity, showSnackbar, closeSnackbar } = useSnackbar();

    // 인증 체크
    useEffect(() => {
        if (!isAuthenticated || !user?.email) {
            window.location.href = '/login';
            return;
        }
    }, [isAuthenticated, user?.email]);

    const [semesterOptions, setSemesterOptions] = useState<string[]>([]);
    const pinnedSemester = userData?.settings?.pinnedSemester || '';
    const [semester, setSemester] = useState<string>(pinnedSemester || '');

    // 학기 목록 로딩
    useEffect(() => {
        (async () => {
            try {
                const { apiService } = await import('../services/ApiService');
                const list = await apiService.getSemesters();
                setSemesterOptions(list || []);

                if (pinnedSemester && list?.includes(pinnedSemester)) {
                    setSemester(pinnedSemester);
                } else if (list?.length && !semester) {
                    setSemester(list[list.length - 1]);
                }
            } catch (e) {
                console.error('학기 목록 조회 실패:', e);
                showSnackbar('학기 목록을 불러오는데 실패했습니다.', 'error');
            }
        })();
    }, [pinnedSemester, semester, showSnackbar]);

    // 데이터 동기화 상태 관리
    const [isDataSyncing, setIsDataSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

    // 인증 상태에 따른 조건부 렌더링
    if (!isAuthenticated || !user?.email) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    useEffect(() => {
        if (pinnedSemester) {
            setSemester(pinnedSemester);
        }
    }, [pinnedSemester]);

    const { courses: timetableSlots, isLoading, saveSchedule } = useSchedule(semester);

    // 서버와 동기화하는 함수
    const syncWithBackend = useCallback(async (newCourses: Course[]) => {
        if (!user?.email || !semester) return false;

        try {
            const { apiService } = await import('../services/ApiService');
            
            // 백엔드가 기대하는 형식으로 데이터 변환
            const backendCourses = newCourses.map(courseToSlot);

            console.log('[DEBUG] 백엔드 전송 데이터:', { semester, courses: backendCourses });

            await apiService.saveTimetable({
                semester,
                courses: backendCourses,
                updatedAt: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('[DEBUG] 백엔드 동기화 실패:', error);
            throw error;
        }
    }, [user?.email, semester]);

    // 데이터 동기화 함수
    const syncDataWithBackend = useCallback(async () => {
        if (!user?.email) return;

        setIsDataSyncing(true);
        try {
            const { apiService } = await import('../services/ApiService');
            const backendTimetable = await apiService.getCurrentTimetable(semester);
            console.log('[DEBUG] backendTimetable raw:', JSON.stringify(backendTimetable, null, 2));
            
            setLastSyncTime(new Date());
        } catch (error) {
            console.warn('[Schedule] Sync failed:', error);
            handleApiError(error, showSnackbar);
        } finally {
            setIsDataSyncing(false);
        }
    }, [user?.email, semester, showSnackbar]);  
    
    useEffect(() => {
        if (!user?.email) return;

        const syncInterval = setInterval(syncDataWithBackend, 5 * 60 * 1000);
        return () => clearInterval(syncInterval);
    }, [user?.email, syncDataWithBackend]);

    // 페이지 진입 시 데이터 동기화
    useEffect(() => {
        if (user?.email && !isDataSyncing) {
            const timer = setTimeout(() => {
                syncDataWithBackend();
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [user?.email, syncDataWithBackend]);

    // TimetableSlot을 Course로 변환
    const courses = timetableSlots;
    console.log('[DEBUG] 최종 courses:', courses);
    const { open: openDialog, data: dialogCourse, openDialog: showDialog, closeDialog } = useDialog<Course>();
    const { open: openDetailDialog, data: detailCourse, openDialog: showDetail, closeDialog: closeDetail } = useDialog<Course>();
    const { open: openExcelModal, data: imageCourse, openDialog: showExcelModal, closeDialog: closeExcelModal } = useDialog<Course>();
    const location = useLocation();
    const [highlightCourseId, setHighlightCourseId] = useState<string | null>(null);

    // 추가 버튼 메뉴 상태
    const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
    const addButtonRef = useRef<HTMLButtonElement | null>(null);
    const handleAddButtonClick = (e: React.MouseEvent<HTMLElement>) => setAddMenuAnchor(e.currentTarget);
    const handleAddMenuClose = () => setAddMenuAnchor(null);

    // FAB 메뉴 상태
    const [fabMenuAnchor, setFabMenuAnchor] = useState<null | HTMLElement>(null);
    const handleFabClick = (e: React.MouseEvent<HTMLElement>) => setFabMenuAnchor(e.currentTarget);
    const handleFabMenuClose = () => setFabMenuAnchor(null);

    // 과목 저장 함수
    const handleSaveCourse = async (courseData: Partial<Course>) => {
        console.log('[DEBUG] 전송할 데이터:', courseData);
        
        try {
            // 데이터 검증 및 변환
            const sanitizedCourse: Course = {
                id: courseData.id || Date.now().toString(),
                name: courseData.name || '새 과목',
                code: courseData.code || '',
                instructor: courseData.instructor || '',
                credits: Number(courseData.credits) || 3,
                type: courseData.type || 'elective',
                day: courseData.day || 'monday',
                startPeriod: Math.max(1, Math.min(14, Number(courseData.startPeriod) || 1)),
                endPeriod: Math.max(1, Math.min(14, Number(courseData.endPeriod) || 1)),
                startTime: courseData.startTime || '09:00',
                endTime: courseData.endTime || '10:30',
                room: courseData.room || '',
            };

            // 교시 순서 검증
            if (sanitizedCourse.startPeriod > sanitizedCourse.endPeriod) {
                sanitizedCourse.endPeriod = sanitizedCourse.startPeriod;
            }

            let newCourses: Course[];
            if (dialogCourse) {
                newCourses = courses.map(course =>
                    course.id === dialogCourse.id ? sanitizedCourse : course
                );
            } else {
                newCourses = [...courses, sanitizedCourse];
            }

            await saveSchedule(newCourses);
            await syncWithBackend(newCourses);
            
            showSnackbar('과목이 저장되었습니다.', 'success');
            closeDialog();
        } catch (error) {
            console.error('[DEBUG] 저장 실패:', error);
            handleApiError(error, showSnackbar);
        }
    };

    // 과목 삭제 함수
    const handleDeleteCourse = async (id: string) => {
        try {
            const newCourses = courses.filter(course => course.id !== id);

            // 1. 로컬에서 삭제
            await saveSchedule(newCourses);

            // 2. 백엔드에 반영
            await syncWithBackend(newCourses);
            
            showSnackbar('과목이 삭제되었습니다.', 'success');
            closeDialog();
        } catch (error) {
            handleApiError(error, showSnackbar);
        }
    };

    // 시간표 초기화 함수
    const handleResetConfirm = async () => {
        try {
            // 1. 로컬에서 초기화
            await saveSchedule([]);

            // 2. 백엔드에 반영
            await syncWithBackend([]);
            
            showSnackbar('시간표가 초기화되었습니다.', 'success');
            setResetDialogOpen(false);
        } catch (error) {
            handleApiError(error, showSnackbar);
        }
    };

    // 기타 핸들러들
    const handleAddCourse = () => showDialog();
    const handleEditCourse = (course: Course) => showDialog(course);
    
    const handleExcelUpload = async (file: File) => {
        try {
            showSnackbar('엑셀 업로드 중...', 'info');

            const formData = new FormData();
            formData.append('file', file);
            formData.append('semester', semester);

            const response = await apiClient.post('/timetable/upload-excel', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            if (response.data?.success && response.data.data?.courses) {
                const backendCourses = response.data.data.courses.map(slotToCourse);
                await saveSchedule(backendCourses);
            }
            showSnackbar('엑셀에서 시간표가 반영되었습니다.', 'success');
        } catch (error) {
            console.error('엑셀 업로드 실패:', error);
            showSnackbar('엑셀 업로드 실패. 파일을 확인해주세요.', 'error');
        } finally {
            closeExcelModal();
        }
    };


    const handlePinClick = () => {
        if (!user?.email) return;
        if (semester === pinnedSemester) {
            updateSettings({ pinnedSemester: '' });
        } else {
            updateSettings({ pinnedSemester: semester });
        }
    };

    const handleSemesterChange = (e: SelectChangeEvent) => {
        setSemester(e.target.value);
    };

    // 초기화 다이얼로그 상태
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const handleResetClick = () => setResetDialogOpen(true);
    const handleResetCancel = () => setResetDialogOpen(false);

    return (
        <Box sx={{ flexGrow: 1, p: 3, minHeight: '100vh' }}>
            {/* 헤더 */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <School sx={{ fontSize: 'inherit' }} />
                    시간표
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {/* 마지막 동기화 시간 */}
                    {lastSyncTime && (
                        <Typography variant="caption" color="text.secondary">
                            마지막 동기화: {lastSyncTime.toLocaleTimeString()}
                        </Typography>
                    )}

                    {/* 학기 선택 */}
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <InputLabel>학기</InputLabel>
                        <Select
                            value={semester}
                            label="학기"
                            onChange={handleSemesterChange}
                        >
                            {semesterOptions.map((sem) => (
                                <MenuItem key={sem} value={sem}>
                                    {sem}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* 핀 버튼 */}
                    <Tooltip title={semester === pinnedSemester ? '고정 해제' : '학기 고정'}>
                        <IconButton onClick={handlePinClick}>
                            {semester === pinnedSemester ? <PushPinIcon /> : <PushPinOutlinedIcon />}
                        </IconButton>
                    </Tooltip>

                    {/* 동기화 버튼 */}
                    <Tooltip title="동기화">
                        <IconButton onClick={syncDataWithBackend} disabled={isDataSyncing}>
                            <RestartAltIcon />
                        </IconButton>
                    </Tooltip>

                    {/* 초기화 버튼 */}
                    <Tooltip title="시간표 초기화">
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={handleResetClick}
                            size="small"
                        >
                            초기화
                        </Button>
                    </Tooltip>

                    {/* 추가 버튼 */}
                    <Button
                        ref={addButtonRef}
                        variant="contained"
                        startIcon={<Add />}
                        onClick={handleAddButtonClick}
                    >
                        과목 추가
                    </Button>
                </Box>
            </Box>

            {/* 시간표 그리드 */}
            <Paper elevation={3} sx={{ p: 3, borderRadius: 2 }}>
                <TimetableGrid
                    courses={courses}
                    onCourseClick={handleEditCourse}
                    highlightCourseId={highlightCourseId}
                />
            </Paper>

            {/* 추가 메뉴 */}
            <MuiMenu
                anchorEl={addMenuAnchor}
                open={Boolean(addMenuAnchor)}
                onClose={handleAddMenuClose}
            >
                <MuiMenuItem onClick={() => { handleAddCourse(); handleAddMenuClose(); }}>
                    직접 추가
                </MuiMenuItem>
                <MuiMenuItem onClick={() => { showExcelModal(); handleAddMenuClose(); }}>
                    <Image sx={{ mr: 1 }} />
                    엑셀로 추가
                </MuiMenuItem>
            </MuiMenu>

            {/* 모달들 */}
            <Suspense fallback={<CircularProgress />}>
                <CourseEditModal
                    open={openDialog}
                    onClose={closeDialog}
                    onSave={handleSaveCourse}
                    course={dialogCourse}
                    onDelete={handleDeleteCourse}
                />
            </Suspense>

            <Suspense fallback={<CircularProgress />}>
                <CourseDetailModal
                    open={openDetailDialog}
                    onClose={closeDetail}
                    course={detailCourse}
                />
            </Suspense>

            <ExcelUploadModal 
                open={openExcelModal} 
                onClose={closeExcelModal} 
                onUpload={handleExcelUpload} 
            />

            {/* 스낵바 */}
            <Snackbar 
                open={snackbarOpen} 
                autoHideDuration={4000} 
                onClose={closeSnackbar} 
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={closeSnackbar} severity={severity || 'success'} sx={{ width: '100%' }}>
                    {message}
                </Alert>
            </Snackbar>

            {/* 로딩 백드롭 */}
            <Backdrop
                open={isLoading || isDataSyncing}
                sx={{
                    zIndex: 2000,
                    color: '#fff',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                }}
            >
                <CircularProgress color="inherit" />
                <Typography variant="body1" color="inherit">
                    {isDataSyncing ? '동기화 중...' : '데이터를 불러오는 중...'}
                </Typography>
            </Backdrop>

            {/* 초기화 확인 다이얼로그 */}
            <Dialog open={resetDialogOpen} onClose={handleResetCancel} TransitionComponent={Fade} keepMounted>
                <DialogTitle>시간표 초기화</DialogTitle>
                <DialogContent>
                    <Typography>정말로 이 학기의 시간표를 모두 삭제하시겠습니까?</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                        이 작업은 백엔드에서도 삭제되며 되돌릴 수 없습니다.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleResetCancel}>취소</Button>
                    <Button onClick={handleResetConfirm} color="error" variant="contained">
                        초기화
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Schedule;