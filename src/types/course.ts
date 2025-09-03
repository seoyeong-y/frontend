export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

// 백엔드 type 그대로 반영
export type CourseType = 'GR' | 'GE' | 'MR' | 'ME' | 'RE' | 'FE';

export interface CourseCore {
    id: string;
    name: string;       // 과목명
    code: string;       // 과목 코드
    day: DayKey;        // 요일
    startPeriod: number;
    endPeriod: number;
    credits: number;    // 학점
    room: string;
    type: CourseType;   // 'GR' | 'GE' | 'MR' | 'ME' | 'RE' | 'FE'
    instructor: string;

    // 선택 속성
    locked?: boolean;
    starred?: boolean;
    selected?: boolean;
    color?: string;
}

export interface Course extends CourseCore {
    startTime: string;  // '09:30'
    endTime: string;    // '10:20'
}