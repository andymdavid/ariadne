import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'

function App() {
  return (
    <Layout>
      <div style={{ height: '100vh', padding: '20px' }}>
        <h1>Ariadne - Test</h1>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
        </Routes>
      </div>
    </Layout>
  )
}

export default App