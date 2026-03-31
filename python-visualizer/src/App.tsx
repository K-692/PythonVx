import { Toolbar } from './components/Toolbar';
import { CodeEditor } from './components/CodeEditor';
import { Visualizer } from './components/Visualizer';
import Split from 'react-split';
import './index.css';

function App() {
  return (
    <div className="app-container">
      <Toolbar />
      <Split 
        className="main-content"
        sizes={[50, 50]}
        minSize={300}
        gutterSize={6}
        gutterAlign="center"
        snapOffset={30}
        dragInterval={1}
        direction="horizontal"
        cursor="col-resize"
      >
        <CodeEditor />
        <Visualizer />
      </Split>
    </div>
  );
}

export default App;
