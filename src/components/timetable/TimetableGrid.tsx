import React, { useMemo } from 'react';
import { periods } from '../../data/periodMap';
import { Course, DayKey } from '../../types/course';
import CourseBlock from './CourseBlock';

interface TimetableGridProps {
    courses: Course[];
    onCourseClick: (course: Course) => void;
    highlightCourseId?: string | null;
}

const TimetableGrid: React.FC<TimetableGridProps> = ({ courses, onCourseClick, highlightCourseId }) => {
    console.log('[DEBUG] TimetableGrid props.courses:', courses);
    
    // 모든 가능한 요일 정의
    const allDayKeys: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = {
        monday: '월',
        tuesday: '화',
        wednesday: '수',
        thursday: '목',
        friday: '금',
        saturday: '토',
        sunday: '일'
    };

    // 실제 사용되는 요일들 계산
    const usedDays = useMemo(() => {
        const daysInCourses = new Set(courses.map(course => course.day).filter(Boolean));
        
        // 기본적으로 월~금은 항상 표시
        const baseDays: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        
        // 토/일이 사용되면 추가
        if (daysInCourses.has('saturday')) baseDays.push('saturday');
        if (daysInCourses.has('sunday')) baseDays.push('sunday');
        
        return baseDays;
    }, [courses]);

    const dayCount = usedDays.length;

    return (
        <div className="flex-grow relative bg-white rounded-2xl shadow-xl overflow-hidden p-1">
            <div className="overflow-auto h-full" 
                style={{
                    scrollbarWidth: 'none',
                }}
            >
                <div 
                    className="relative grid grid-rows-[40px_repeat(14,56px)]"
                    style={{ 
                        gridTemplateColumns: `60px repeat(${dayCount}, 1fr)`,
                        minWidth: '1200px'
                    }}
                >
                    {/* Day Headers */}
                    {usedDays.map((day, index) => (
                        <div
                            key={day}
                            className="sticky top-0 z-20 text-center flex items-center justify-center bg-white"
                            style={{ gridColumn: index + 2, gridRow: 1 }}
                        >
                            <span className="font-bold text-gray-600">{dayNames[day]}</span>
                        </div>
                    ))}

                    {/* Time Labels */}
                    {periods.map((period, index) => (
                        <div
                            key={period.label}
                            className="sticky left-0 z-10 flex items-center justify-center text-xs bg-white"
                            style={{ gridRow: index + 2, gridColumn: 1 }}
                        >
                            {index % 2 === 0 ? (
                                <span className="font-semibold text-gray-800">{period.label}</span>
                            ) : (
                                <span className="text-gray-400">{period.label}</span>
                            )}
                        </div>
                    ))}

                    {/* Grid Background */}
                    <div
                        className="absolute top-[40px] left-[60px] right-0 bottom-0 pointer-events-none"
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${dayCount}, 1fr)`,
                            gridTemplateRows: 'repeat(14, 56px)',
                        }}
                    >
                        {Array.from({ length: dayCount * 14 }).map((_, i) => (
                            <div key={i} className="border-r border-b border-gray-100" />
                        ))}
                    </div>

                    {/* Course Blocks */}
                    <div 
                        className="col-start-2 row-start-2 row-span-full"
                        style={{ 
                            gridColumnEnd: dayCount + 2,
                            display: 'grid',
                            gridTemplateColumns: `repeat(${dayCount}, 1fr)`,
                            gridTemplateRows: 'repeat(14, 56px)',
                        }}
                    >
                        {courses.map(course => {
                            if (!course.day) {
                                console.warn("Invalid course day:", course);
                                return null;
                            }
                            
                            const dayIndex = usedDays.indexOf(course.day);
                            if (dayIndex === -1) {
                                console.warn("Day not found in usedDays:", course.day);
                                return null;
                            }
                            
                            return (
                                <CourseBlock
                                    key={course.id}
                                    course={course}
                                    onClick={onCourseClick}
                                    highlight={highlightCourseId === course.id}
                                    dayIndex={dayIndex}
                                />
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(TimetableGrid);