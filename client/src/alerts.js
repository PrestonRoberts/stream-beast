import React, { Component } from 'react';
import AlertBox from './components/alertBox';
import Streambeast from './components/streambeast';

class Alerts extends Component {
  render() { 
    return (
      <div>
        <Streambeast data={this.props.streambeastData} />
        <AlertBox message={this.props.alertMessage} />
      </div>
    );
  }
}
 
export default Alerts;