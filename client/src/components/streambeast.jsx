import React, { Component } from "react";

class Streambeast extends Component {
    render() { 
        return (
            <div>
                {this.generateMessage()}
            </div>
        );
    }

    generateMessage(){
        let data = this.props.data;

        if (data.type === 'none') return '';

        let msgStyle = {
            backgroundColor: data.backgroundColor,
            color: data.textColor
        };

        let final = <p className="streambeast" style={msgStyle}>{data.message}</p>;
        return final;
    }
}
 
export default Streambeast;