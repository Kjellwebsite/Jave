import './styles/main.css';
import { CORE, taskById } from './tasks';
import type { Nav } from './views/common';
import { renderHome } from './views/home';
import { renderReport } from './views/report';
import { renderTask } from './views/taskView';

const root = document.getElementById('app')!;

const nav: Nav = {
  home: () => renderHome(root, nav),
  report: () => renderReport(root, nav),
  task: (id, mode) => {
    const task = taskById(id) ?? CORE[0];
    void renderTask(root, task, mode, nav);
  },
};

nav.home();
