/// <reference types="vite/client" />

declare module '*.svg' {
    import React from 'react';
    export const ReactComponent: React.SFC<React.SVGProps<SVGSVGElement>>;
    const src: string;
    export default src;
}

declare module '*.jpg' {
    const content: string;
    export default content;
}

declare module '*.png' {
    const content: string;
    export default content;
}

declare module '*.json' {
    const content: Record<string, unknown>;
    export default content;
}
