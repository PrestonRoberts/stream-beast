import React, { Component } from "react";

class AlertBox extends Component {
    render() { 
        return (
            <div>
                {this.generateMessage()}
            </div>
        );
    }

    generateMessage(){
        let message = this.props.message;
        let final = message === "" ? "" : <p className="alertbox">{message}</p>;
        return final;
    }
}
 
export default AlertBox;